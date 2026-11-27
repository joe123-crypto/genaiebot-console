import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The workspace resolver is the one place a request learns whose data it may
 * see, so these exercise the real module against an in-memory registry: first
 * visits create exactly one workspace, a pointer to someone else's workspace
 * is refused, an unreadable registry shows nothing, and each workspace's bot
 * gets its own derived token.
 */
vi.unmock("@/src/lib/workspace");

type Doc = Record<string, unknown>;
const store = new Map<string, Doc>();
let reads = 0;
let failing = false;

function ref(path: string) {
  return {
    path,
    async get() {
      reads++;
      if (failing) throw new Error("registry down");
      const data = store.get(path);
      return { exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] };
    },
    async update(fields: Doc) {
      if (!store.has(path)) throw new Error("no document");
      store.set(path, { ...store.get(path), ...fields });
    },
  };
}
const db = {
  collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
  async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    if (failing) throw new Error("registry down");
    const staged = new Map<string, Doc>();
    const tx = {
      get: (target: ReturnType<typeof ref>) => target.get(),
      create: (target: ReturnType<typeof ref>, data: Doc) => {
        if (store.has(target.path) || staged.has(target.path)) throw new Error("already exists");
        staged.set(target.path, data);
      },
      update: (target: ReturnType<typeof ref>, data: Doc) => {
        staged.set(target.path, { ...store.get(target.path), ...staged.get(target.path), ...data });
      },
    };
    const result = await fn(tx);
    for (const [path, data] of staged) store.set(path, data);
    return result;
  },
};
vi.mock("@/src/lib/firebase-admin", () => ({ firestoreAdmin: () => db }));
vi.mock("next/navigation", () => ({ redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }) }));

import { getOperator } from "@/src/lib/auth";
import {
  NoBotError, WorkspaceUnavailableError, botTarget, deriveBotToken, finishOnboarding, forgetCachedWorkspaces,
  getWorkspace, holdOnboardingOpen, requireBot, requireWorkspace,
} from "@/src/lib/workspace";

const SECRET = "s".repeat(40);
const ALICE = { uid: "uid-alice", email: "alice@example.com", name: "Alice" };
const BOB = { uid: "uid-bob", email: "bob@example.com", name: "Bob" };
const as = (operator: typeof ALICE | null) => vi.mocked(getOperator).mockResolvedValue(operator);

beforeEach(() => {
  store.clear(); reads = 0; failing = false;
  forgetCachedWorkspaces();
  vi.stubEnv("BOT_TOKEN_SECRET", SECRET);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("deriveBotToken", () => {
  it("is stable per workspace, different across workspaces and secrets, and long enough for the bot", () => {
    const token = deriveBotToken("wk-alpha1", SECRET);
    expect(token).toBe(deriveBotToken("wk-alpha1", SECRET));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(deriveBotToken("wk-beta12", SECRET)).not.toBe(token);
    expect(deriveBotToken("wk-alpha1", "t".repeat(40))).not.toBe(token);
  });

  it("refuses without a strong secret or with a malformed id", () => {
    expect(() => deriveBotToken("wk-alpha1", "")).toThrow(WorkspaceUnavailableError);
    expect(() => deriveBotToken("wk-alpha1", "short")).toThrow(WorkspaceUnavailableError);
    expect(() => deriveBotToken("../x", SECRET)).toThrow(WorkspaceUnavailableError);
  });
});

describe("getWorkspace", () => {
  it("creates one workspace on a first visit, owned by the user, with no bot", async () => {
    as(ALICE);
    const workspace = await getWorkspace();
    expect(workspace).toMatchObject({ ownerUid: ALICE.uid, bot: null });
    expect(workspace!.id).toMatch(/^[A-Za-z0-9_-]{6,40}$/);
    expect(store.get(`consoleUsers/${ALICE.uid}`)).toMatchObject({ email: ALICE.email, workspaceId: workspace!.id });
    expect(store.get(`workspaces/${workspace!.id}`)).toMatchObject({ ownerUid: ALICE.uid, bot: null });
    forgetCachedWorkspaces();
    expect((await getWorkspace())!.id).toBe(workspace!.id);
    expect([...store.keys()].filter((key) => key.startsWith("workspaces/"))).toHaveLength(1);
  });

  it("returns the existing workspace a migration registered, never a new empty one", async () => {
    store.set(`consoleUsers/${ALICE.uid}`, { email: ALICE.email, workspaceId: "wk-alice1" });
    store.set("workspaces/wk-alice1", { name: "Alice's", ownerUid: ALICE.uid, bot: { baseUrl: "https://alice-bot.example" } });
    as(ALICE);
    expect(await getWorkspace()).toEqual({ id: "wk-alice1", name: "Alice's", ownerUid: ALICE.uid,
                                           bot: { baseUrl: "https://alice-bot.example" }, onboarding: "done" });
    expect([...store.keys()].filter((key) => key.startsWith("workspaces/"))).toEqual(["workspaces/wk-alice1"]);
  });

  it("gives two users two workspaces", async () => {
    as(ALICE); const alice = await getWorkspace();
    as(BOB); const bob = await getWorkspace();
    expect(alice!.id).not.toBe(bob!.id);
    expect(bob!.ownerUid).toBe(BOB.uid);
  });

  it("refuses a pointer to someone else's workspace", async () => {
    store.set("workspaces/wk-alice1", { ownerUid: ALICE.uid, bot: { baseUrl: "https://alice-bot.example" } });
    store.set(`consoleUsers/${BOB.uid}`, { email: BOB.email, workspaceId: "wk-alice1" });
    as(BOB);
    await expect(getWorkspace()).rejects.toBeInstanceOf(WorkspaceUnavailableError);
  });

  it("shows nothing when the registry cannot be read", async () => {
    failing = true;
    as(ALICE);
    await expect(getWorkspace()).rejects.toBeInstanceOf(WorkspaceUnavailableError);
  });

  it.each(["http://bot.example", "https://bot.example/internal", "https://user:pw@bot.example", "not a url"])(
    "refuses an unusable bot address %s rather than treating it as no bot", async (baseUrl) => {
      store.set(`consoleUsers/${ALICE.uid}`, { workspaceId: "wk-alice1" });
      store.set("workspaces/wk-alice1", { ownerUid: ALICE.uid, bot: { baseUrl } });
      as(ALICE);
      await expect(getWorkspace()).rejects.toBeInstanceOf(WorkspaceUnavailableError);
    });

  it("reads the registry once per user per cache window", async () => {
    as(ALICE);
    await getWorkspace();
    const after = reads;
    await getWorkspace();
    expect(reads).toBe(after);
  });

  it("never reads or writes another app's users collection", async () => {
    // agent_genaie shares the project and its uids, and keeps profiles here.
    store.set(`users/${ALICE.uid}`, { onboarding: "complete", plan: "pro" });
    as(ALICE);
    const workspace = await getWorkspace();
    expect(workspace!.ownerUid).toBe(ALICE.uid);
    expect(store.get(`users/${ALICE.uid}`)).toEqual({ onboarding: "complete", plan: "pro" });
    expect(store.get(`consoleUsers/${ALICE.uid}`)).toMatchObject({ workspaceId: workspace!.id });
  });

  it("is null when nobody is signed in, and creates nothing", async () => {
    as(null);
    expect(await getWorkspace()).toBeNull();
    expect(store.size).toBe(0);
  });
});

describe("botTarget and requireBot", () => {
  it("has no bot to offer a new workspace: no address, no token", async () => {
    as(ALICE);
    await expect(botTarget()).rejects.toBeInstanceOf(NoBotError);
    await expect(botTarget()).rejects.toMatchObject({ status: 409 });
    await expect(requireBot()).rejects.toThrow("REDIRECT /onboarding");
  });

  it("sends each user to their own bot with their own token", async () => {
    store.set(`consoleUsers/${ALICE.uid}`, { workspaceId: "wk-alice1" });
    store.set("workspaces/wk-alice1", { ownerUid: ALICE.uid, bot: { baseUrl: "https://alice-bot.example/" } });
    store.set(`consoleUsers/${BOB.uid}`, { workspaceId: "wk-bobbb1" });
    store.set("workspaces/wk-bobbb1", { ownerUid: BOB.uid, bot: { baseUrl: "https://bob-bot.example" } });
    as(ALICE); const alice = await botTarget();
    as(BOB); const bob = await botTarget();
    expect(alice).toEqual({ baseUrl: "https://alice-bot.example", token: deriveBotToken("wk-alice1", SECRET), workspaceId: "wk-alice1" });
    expect(bob).toEqual({ baseUrl: "https://bob-bot.example", token: deriveBotToken("wk-bobbb1", SECRET), workspaceId: "wk-bobbb1" });
  });

  it("fails closed without the token secret", async () => {
    vi.stubEnv("BOT_TOKEN_SECRET", "");
    store.set(`consoleUsers/${ALICE.uid}`, { workspaceId: "wk-alice1" });
    store.set("workspaces/wk-alice1", { ownerUid: ALICE.uid, bot: { baseUrl: "https://alice-bot.example" } });
    as(ALICE);
    await expect(botTarget()).rejects.toBeInstanceOf(WorkspaceUnavailableError);
  });

  it("sends a signed-out request nowhere", async () => {
    as(null);
    await expect(botTarget()).rejects.toMatchObject({ status: 401 });
    await expect(requireBot()).rejects.toThrow("REDIRECT /login");
  });
});

describe("onboarding", () => {
  const alice = (fields: Doc) => {
    store.set(`consoleUsers/${ALICE.uid}`, { workspaceId: "wk-alice1" });
    store.set("workspaces/wk-alice1", { ownerUid: ALICE.uid, bot: null, ...fields });
    as(ALICE);
  };

  it("starts a new workspace in onboarding, and sends every page to the wizard", async () => {
    as(ALICE);
    const workspace = await getWorkspace();
    expect(workspace!.onboarding).toBe("pending");
    expect(store.get(`workspaces/${workspace!.id}`)).toMatchObject({ onboarding: { status: "pending" } });
    await expect(requireWorkspace()).rejects.toThrow("REDIRECT /onboarding");
    await expect(requireBot()).rejects.toThrow("REDIRECT /onboarding");
  });

  it("leaves a workspace set up before onboarding existed alone, and gives one without a bot the wizard", async () => {
    alice({ bot: { baseUrl: "https://alice-bot.example" } });
    expect((await getWorkspace())!.onboarding).toBe("done");
    forgetCachedWorkspaces();
    alice({});
    expect((await getWorkspace())!.onboarding).toBe("pending");
  });

  it("lets a workspace that skipped open every page, and sends pages that need a bot home", async () => {
    alice({ onboarding: { status: "skipped" } });
    await expect(requireWorkspace()).resolves.toMatchObject({ id: "wk-alice1", bot: null, onboarding: "skipped" });
    await expect(requireBot()).rejects.toThrow(/^REDIRECT \/$/);
  });

  it("ends onboarding once, for good: a finished one is never reopened", async () => {
    alice({ onboarding: { status: "pending" } });
    await finishOnboarding("skipped");
    expect(store.get("workspaces/wk-alice1")).toMatchObject({ onboarding: { status: "skipped" } });
    // Read again at once: the cache must not still say pending.
    expect((await getWorkspace())!.onboarding).toBe("skipped");
    await finishOnboarding("done");
    expect(store.get("workspaces/wk-alice1")).toMatchObject({ onboarding: { status: "skipped" } });
  });

  it("writes down an unstored pending before the bot is made, and nothing when a status is stored", async () => {
    alice({});
    await holdOnboardingOpen((await getWorkspace())!);
    expect(store.get("workspaces/wk-alice1")).toMatchObject({ onboarding: { status: "pending" } });
    forgetCachedWorkspaces();
    alice({ onboarding: { status: "skipped" } });
    await holdOnboardingOpen((await getWorkspace())!);
    expect(store.get("workspaces/wk-alice1")).toMatchObject({ onboarding: { status: "skipped" } });
  });
});
