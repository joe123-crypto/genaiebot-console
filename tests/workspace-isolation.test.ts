/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Open sign-up means a stranger's first request arrives with a workspace and no
 * bot. That request must reach no bot at all -- not a default one, not the last
 * one another user used -- and must not spend the shared OpenRouter key or get
 * an upload URL. Globbed like auth-coverage, so a new page or action is covered
 * the day it is added.
 */
vi.mock("@/src/config", async (original) => ({
  ...await original<typeof import("@/src/config")>(),
  BOT_SOURCE: "remote", WRITE_SOURCE: "remote", WRITES_ENABLED: true, ACCOUNT_WRITES_ENABLED: true,
}));
vi.mock("next/navigation", async (original) => ({
  ...await original<typeof import("next/navigation")>(),
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/campaign-upload", async (original) => ({
  ...await original<typeof import("@/src/lib/campaign-upload")>(),
  imageUploadConfigured: () => true, signCampaignUpload: vi.fn(async () => { throw new Error("signed an upload"); }),
}));

import { NoBotError, botTarget, getWorkspace, requireBot, requireWorkspace, type Workspace } from "@/src/lib/workspace";
import { BotUnavailableError } from "@/src/lib/bot-errors";
import { signCampaignUpload } from "@/src/lib/campaign-upload";

const pages = import.meta.glob("../app/**/page.tsx");
const actions = import.meta.glob(["../app/**/actions.ts", "../app/**/caption-ai-actions.ts"]);
const apis = import.meta.glob("../app/api/**/route.ts");
const fetchSpy = vi.fn(() => { throw new Error("reached the network"); });
const NEW_USER: Workspace = { id: "w-newuser1", name: "New user's workspace", ownerUid: "test-operator", bot: null, onboarding: "pending" };
const SKIPPED: Workspace = { ...NEW_USER, onboarding: "skipped" };
let current: Workspace;

/** The two guards as the real module runs them, over whichever workspace this test has. */
function as(workspace: Workspace) {
  current = workspace;
  vi.mocked(getWorkspace).mockImplementation(async () => current);
  vi.mocked(requireWorkspace).mockImplementation(async () => {
    if (current.onboarding === "pending") throw new Error("REDIRECT /onboarding");
    return current;
  });
  vi.mocked(requireBot).mockImplementation(async () => {
    if (current.onboarding === "pending") throw new Error("REDIRECT /onboarding");
    if (!current.bot) throw new Error("REDIRECT /");
    return current;
  });
}

beforeEach(() => {
  fetchSpy.mockClear(); vi.stubGlobal("fetch", fetchSpy);
  as(NEW_USER);
  vi.mocked(botTarget).mockRejectedValue(new NoBotError());
  vi.stubEnv("OPENROUTER_API_KEY", "server-key");
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(signCampaignUpload).not.toHaveBeenCalled();
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

const request = (method: string) => new Request("http://localhost:3000/api/x", {
  method, headers: { origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json" },
  ...(method === "GET" ? {} : { body: JSON.stringify({ slug: "demo", id: "default", image: {} }) }),
});

const props = () => ({ params: Promise.resolve({ slug: "demo", variant: "1" }), searchParams: Promise.resolve({}) });
type Page = { default: (...args: unknown[]) => unknown };
/** The pages in the nav: with no bot they show their own empty state. */
const NAV_PAGES = ["../app/page.tsx", "../app/groups/page.tsx", "../app/campaigns/page.tsx",
  "../app/customer-bot/page.tsx", "../app/lines/page.tsx", "../app/settings/page.tsx", "../app/setup/page.tsx",
  "../app/account/page.tsx"];

describe("a new workspace is in onboarding", () => {
  for (const [path, load] of Object.entries(pages)) {
    if (path.includes("/login/") || path.includes("/schedule/") || path.includes("/onboarding/")) continue;
    it(`page ${path} sends it to the wizard first`, async () => {
      await expect((await load() as Page).default(props())).rejects.toThrow("REDIRECT /onboarding");
    });
  }

  it("starts the wizard on the bot step, which renders without calling a bot", async () => {
    const { default: Onboarding } = await import("@/app/onboarding/page");
    await expect(Onboarding()).rejects.toThrow("REDIRECT /onboarding/bot");
    const { default: BotStep } = await import("@/app/onboarding/bot/page");
    await expect(BotStep()).resolves.toBeTruthy();
  });

  it.each(["whatsapp/page.tsx", "campaign/page.tsx", "campaign/caption/page.tsx"])(
    "holds back the %s step until there is a bot", async (step) => {
      const { default: Step } = await pages[`../app/onboarding/${step}`]() as Page;
      await expect(Step()).rejects.toThrow("REDIRECT /onboarding/bot");
    });
});

describe("a workspace that skipped onboarding, with no bot, reaches no bot", () => {
  beforeEach(() => as(SKIPPED));

  for (const [path, load] of Object.entries(pages)) {
    if (path.includes("/login/") || path.includes("/schedule/")) continue;
    if (NAV_PAGES.includes(path)) {
      it(`page ${path} renders its own empty state`, async () => {
        await expect((await load() as Page).default(props())).resolves.toBeTruthy();
      });
    } else {
      it(`page ${path} sends it home`, async () => {
        await expect((await load() as Page).default(props())).rejects.toThrow(/^REDIRECT \/$/);
      });
    }
  }
  for (const [path, load] of Object.entries(actions)) {
    it(`actions in ${path} make no bot or paid call`, async () => {
      const module = await load() as Record<string, (...args: unknown[]) => unknown>;
      for (const action of Object.values(module)) {
        if (typeof action !== "function") continue;
        try { await action({ slug: "demo", messages: [{ role: "user", content: "hi" }], caption: "x" }, "demo"); }
        catch (error) { if (!(error instanceof BotUnavailableError) && !(error instanceof Error)) throw error; }
      }
    });
  }
  for (const [path, load] of Object.entries(apis)) {
    if (path.includes("/auth/")) continue;
    it(`every handler in ${path} answers without a bot`, async () => {
      const module = await load() as Record<string, (request: Request, context: unknown) => Promise<Response>>;
      for (const method of ["GET", "POST"]) {
        if (!module[method]) continue;
        const response = await module[method](request(method), { params: Promise.resolve({ view: "groups", path: [] }) });
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    });
  }
});

describe("paid and storage calls need a connected bot", () => {
  it("refuses a valid caption assistant request before spending the shared key", async () => {
    const { suggestCaptionAction } = await import("@/app/campaigns/caption-ai-actions");
    const outcome = await suggestCaptionAction({ caption: "Fresh fruit trees", prompt: "Make it shorter", history: [] });
    expect(outcome).toMatchObject({ ok: false, detail: expect.stringContaining("Connect a bot") });
  });

  it("signs no upload URL for a valid picture", async () => {
    const { POST } = await import("@/app/api/campaigns/uploads/route");
    const sha256 = "a".repeat(64);
    const response = await POST(new Request("http://localhost:3000/api/campaigns/uploads", {
      method: "POST", headers: { origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ slug: "demo", image: { filename: "a.jpg", contentType: "image/jpeg", bytes: 10, sha256,
                                                    key: `workspaces/wk-alice1/campaigns/demo/${sha256}.jpg` } }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "No bot is connected to your workspace yet." });
  });
});

describe("the setup page", () => {
  it("sends a workspace that has a bot back home", async () => {
    as({ ...SKIPPED, bot: { baseUrl: "https://bot.example" } });
    const { default: SetupPage } = await import("@/app/setup/page");
    await expect(SetupPage()).rejects.toThrow(/^REDIRECT \/$/);
  });
});
