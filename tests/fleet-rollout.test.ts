import { beforeEach, describe, expect, it, vi } from "vitest";
import { firestoreFake } from "./fixtures/firestore";
import "./auth-fixture";

/**
 * The fleet rollout end to end against a fake Railway and fake bots. What these
 * pin is what decides how far a bad release spreads: one bot at a time, nothing
 * deployed to a bot that is busy or cannot be seen, exactly one deploy per
 * start, and a failure that puts the bot back and stops everyone else.
 */

const fake = firestoreFake();
vi.mock("@/src/lib/firebase-admin", () => ({ firestoreAdmin: () => fake.db }));

type Service = { image: string | null; deployments: string[] };
const railway = vi.hoisted(() => ({
  services: {} as Record<string, { image: string | null; deployments: string[] }>,
  statuses: {} as Record<string, string>,
  variables: {} as Record<string, Record<string, string>>,
  calls: [] as string[],
  nextDeployment: 0,
}));
vi.mock("@/src/lib/railway-bot", () => ({
  readServiceInstance: vi.fn(async (id: string) => {
    const service = railway.services[id];
    return { image: service.image, latestDeploymentId: service.deployments.at(-1) ?? null };
  }),
  setServiceSource: vi.fn(async (id: string, image: string) => {
    railway.calls.push(`setImage:${id}:${image.slice(-4)}`);
    railway.services[id].image = image;
  }),
  deployService: vi.fn(async (id: string) => {
    const deployment = `dep-${++railway.nextDeployment}`;
    railway.calls.push(`deploy:${id}`);
    railway.services[id].deployments.push(deployment);
    railway.statuses[deployment] = "DEPLOYING";
    return deployment;
  }),
  readDeploymentStatus: vi.fn(async (id: string) => railway.statuses[id]),
  readTemplateVariables: vi.fn(async () => ({ ...TEMPLATE })),
  readServiceVariables: vi.fn(async (id: string) => ({ ...railway.variables[id] })),
  writeVariables: vi.fn(async (id: string, variables: Record<string, string>) => {
    railway.calls.push(`writeVariables:${id}`);
    railway.variables[id] = { ...variables };
  }),
}));

const bots = vi.hoisted(() => ({
  windows: {} as Record<string, unknown>,
  connected: {} as Record<string, string[]>,
  answering: {} as Record<string, boolean>,
}));
const hostOf = (baseUrl: string) => new URL(baseUrl).host.split(".")[0];
vi.mock("@/src/lib/release-window-client", () => ({
  readReleaseWindow: vi.fn(async (target: { baseUrl: string }) =>
    bots.windows[hostOf(target.baseUrl)] ?? { known: true, quiet: true, nextQuietAt: null }),
}));
vi.mock("@/src/lib/account-client", () => ({
  connectedAccounts: vi.fn(async (target: { baseUrl: string }) => bots.connected[hostOf(target.baseUrl)] ?? ["default"]),
}));
vi.mock("@/src/lib/bot-connect", () => ({
  checkBot: vi.fn(async (origin: string) => {
    if (bots.answering[hostOf(origin)] === false) throw new Error("Your bot could not be reached.");
  }),
}));

const TEMPLATE = {
  GCP_SERVICE_ACCOUNT_B64: "read", GCP_SERVICE_ACCOUNT_WRITE_B64: "write", R2_ACCOUNT_ID: "a", R2_BUCKET: "b",
  R2_ACCESS_KEY_ID: "c", R2_SECRET_ACCESS_KEY: "rotated-secret", OPENROUTER_API_KEY: "o",
  GATEWAY_AUTH_TOKEN: "the-gateways-own",
};

const REPO = "ghcr.io/joe123-crypto/genaebot";
const A = `${REPO}:${"a".repeat(40)}`;
const B = `${REPO}:${"b".repeat(40)}`;
const C = `${REPO}:${"c".repeat(40)}`;
const NOW = Date.parse("2026-11-27T09:00:00.000Z");
const MINUTE = 60_000;

const rollout = () => import("@/src/lib/fleet-rollout");
const store = () => import("@/src/lib/fleet-store");

function bot(id: string, image: string | null) {
  fake.put(`workspaces/${id}`, {
    name: `${id}'s workspace`, ownerUid: `owner-${id}`, bot: { baseUrl: `https://${id}.example` },
    provisioning: { stage: "connecting", outcome: "ready", startedAt: "2026-11-26T09:00:00.000Z",
                    updatedAt: "2026-11-26T09:05:00.000Z", attempt: 1, railway: { serviceId: `svc-${id}` } },
  });
  railway.services[`svc-${id}`] = { image, deployments: ["dep-old"] };
  railway.variables[`svc-${id}`] = { ...TEMPLATE, GATEWAY_AUTH_TOKEN: `own-${id}`, R2_SECRET_ACCESS_KEY: "old-secret" };
}

const release = (id: string) => fake.read(`workspaces/${id}`)?.release as Record<string, any> | undefined;
const fleetDoc = () => fake.read("consoleFleet/release") as Record<string, any> | undefined;
const mutations = () => railway.calls.filter((call) => !call.startsWith("read"));

beforeEach(() => {
  fake.reset();
  vi.stubEnv("BOT_TOKEN_SECRET", "s".repeat(48));
  railway.services = {}; railway.statuses = {}; railway.variables = {}; railway.calls = []; railway.nextDeployment = 0;
  bots.windows = {}; bots.connected = {}; bots.answering = {};
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  fake.put("consoleFleet/release", { image: B, promotedAt: new Date(NOW).toISOString(), source: "ci", settingsGeneration: 0 });
});

describe("starting a bot on a new release", () => {
  it("starts only the first quiet bot: accounts noted, image set, exactly one deploy", async () => {
    bot("wbotone1", A); bot("wbottwo2", A);
    const { advanceFleet } = await rollout();
    const summary = await advanceFleet(NOW);
    expect(summary.started).toBe("wbotone1");
    expect(mutations()).toEqual([`setImage:svc-wbotone1:${B.slice(-4)}`, "deploy:svc-wbotone1"]);
    expect(release("wbotone1")?.attempt).toMatchObject({
      stage: "deploying", target: B, fromImage: A, fromDeploymentId: "dep-old",
      deploymentId: "dep-1", accountsBefore: ["default"] });
    expect(release("wbotone1")?.lease).toBeUndefined();
    expect(release("wbottwo2")).toBeUndefined();
  });

  it("deploys nothing to a bot that is sending, or that cannot say", async () => {
    bot("wbotone1", A); bot("wbottwo2", A);
    bots.windows.wbotone1 = { known: true, quiet: false, nextQuietAt: "2026-11-27T09:40:00.000Z" };
    bots.windows.wbottwo2 = { known: false, reason: "the bot predates release windows" };
    const { advanceFleet } = await rollout();
    const summary = await advanceFleet(NOW);
    expect(mutations()).toEqual([]);
    expect(summary.waiting).toEqual([
      { workspace: "wbotone1", nextQuietAt: "2026-11-27T09:40:00.000Z" },
      { workspace: "wbottwo2", reason: "the bot predates release windows" },
    ]);
  });

  it("settles a bot already running the target without restarting it", async () => {
    bot("wbotone1", B);
    const { advanceFleet } = await rollout();
    expect((await advanceFleet(NOW)).settled).toBe("wbotone1");
    expect(mutations()).toEqual([]);
    expect(release("wbotone1")).toEqual({ image: B, settingsGeneration: 0 });
  });

  it("leaves alone a workspace whose account is being deleted", async () => {
    bot("wbotone1", A);
    fake.put("workspaces/wbotone1", { ...fake.read("workspaces/wbotone1"), deletingAt: new Date(NOW).toISOString() });
    const { advanceFleet } = await rollout();
    await advanceFleet(NOW);
    expect(mutations()).toEqual([]);
  });

  it("has nothing to do, and is not busy, before any release is promoted", async () => {
    bot("wbotone1", A);
    fake.reset();
    bot("wbotone1", A);
    const { advanceFleet } = await rollout();
    const summary = await advanceFleet(NOW);
    expect(summary).toMatchObject({ target: null, upToDate: 0, behind: 0 });
    expect(summary.busy).toBeUndefined();
    expect(mutations()).toEqual([]);
  });

  it("changes nothing while another tick holds the fleet", async () => {
    bot("wbotone1", A);
    fake.put("consoleFleet/release", { ...fleetDoc(),
      tickLease: { holder: "other", until: new Date(NOW + MINUTE).toISOString() } });
    const { advanceFleet } = await rollout();
    expect((await advanceFleet(NOW)).busy).toBe(true);
    expect(mutations()).toEqual([]);
  });
});

describe("a bot in flight", () => {
  it("is watched through its deploy and verified, and only then does the next bot start", async () => {
    bot("wbotone1", A); bot("wbottwo2", A);
    const { advanceFleet } = await rollout();
    await advanceFleet(NOW);
    expect((await advanceFleet(NOW + MINUTE)).inFlight).toEqual({ workspace: "wbotone1", stage: "deploying" });

    railway.statuses["dep-1"] = "SUCCESS";
    expect((await advanceFleet(NOW + 2 * MINUTE)).inFlight).toEqual({ workspace: "wbotone1", stage: "verifying" });
    expect((await advanceFleet(NOW + 3 * MINUTE)).settled).toBe("wbotone1");
    expect(release("wbotone1")).toEqual({ image: B, settingsGeneration: 0 });
    expect(release("wbottwo2")).toBeUndefined();

    expect((await advanceFleet(NOW + 4 * MINUTE)).started).toBe("wbottwo2");
    expect(mutations().filter((call) => call.startsWith("deploy"))).toEqual(["deploy:svc-wbotone1", "deploy:svc-wbottwo2"]);
  });

  it("is put back on its image when its deploy crashes, and the fleet pauses for everyone", async () => {
    bot("wbotone1", A); bot("wbottwo2", A);
    const { advanceFleet } = await rollout();
    await advanceFleet(NOW);
    railway.statuses["dep-1"] = "CRASHED";
    const summary = await advanceFleet(NOW + MINUTE);
    expect(summary.failed?.workspace).toBe("wbotone1");
    expect(summary.paused?.reason).toMatch(/wbotone1: its deployment ended CRASHED\. It was put back on/);
    expect(mutations().slice(-2)).toEqual([`setImage:svc-wbotone1:${A.slice(-4)}`, "deploy:svc-wbotone1"]);
    expect(release("wbotone1")).toMatchObject({ image: A, attempt: { stage: "failed" } });

    // Nobody else gets that release, however many ticks come.
    railway.calls = [];
    for (let tick = 2; tick < 6; tick++) await advanceFleet(NOW + tick * MINUTE);
    expect(mutations()).toEqual([]);
    expect(release("wbottwo2")).toBeUndefined();
  });

  it("stays paused when the job that promoted that release is run again", async () => {
    bot("wbotone1", A); bot("wbottwo2", A);
    const { advanceFleet } = await rollout();
    const { promoteFleet } = await store();
    await advanceFleet(NOW);
    railway.statuses["dep-1"] = "CRASHED";
    await advanceFleet(NOW + MINUTE);
    await promoteFleet(B, "ci", NOW + 2 * MINUTE);
    railway.calls = [];
    expect((await advanceFleet(NOW + 3 * MINUTE)).paused).not.toBeNull();
    expect(mutations()).toEqual([]);
  });

  it("resumes on the next release, starting again with the bot that failed", async () => {
    bot("wbotone1", A); bot("wbottwo2", A);
    const { advanceFleet } = await rollout();
    const { promoteFleet } = await store();
    await advanceFleet(NOW);
    railway.statuses["dep-1"] = "CRASHED";
    await advanceFleet(NOW + MINUTE);
    await promoteFleet(C, "ci", NOW + 2 * MINUTE);
    const summary = await advanceFleet(NOW + 3 * MINUTE);
    expect(summary.paused).toBeNull();
    expect(summary.started).toBe("wbotone1");
    expect(release("wbotone1")?.attempt).toMatchObject({ stage: "deploying", target: C, fromImage: A });
  });

  it("fails a bot that comes back without one of its WhatsApp accounts, naming it", async () => {
    bot("wbotone1", A);
    bots.connected.wbotone1 = ["default", "ads"];
    const { advanceFleet } = await rollout();
    await advanceFleet(NOW);
    railway.statuses["dep-1"] = "SUCCESS";
    await advanceFleet(NOW + MINUTE);
    bots.connected.wbotone1 = ["default"];
    // Reconnecting takes a while, so not yet...
    expect((await advanceFleet(NOW + 5 * MINUTE)).failed).toBeUndefined();
    // ...but ten minutes after the deploy succeeded, it is a failure.
    const summary = await advanceFleet(NOW + 12 * MINUTE);
    expect(summary.failed?.detail).toMatch(/came back without WhatsApp account\(s\) ads/);
    expect(railway.services["svc-wbotone1"].image).toBe(A);
  });

  it("fails a bot that never answers for its workspace again", async () => {
    bot("wbotone1", A);
    const { advanceFleet } = await rollout();
    await advanceFleet(NOW);
    railway.statuses["dep-1"] = "SUCCESS";
    await advanceFleet(NOW + MINUTE);
    bots.answering.wbotone1 = false;
    const summary = await advanceFleet(NOW + 12 * MINUTE);
    expect(summary.failed?.detail).toMatch(/did not answer for its workspace within 10 minutes/);
  });

  it("fails a deploy that never finishes", async () => {
    bot("wbotone1", A);
    const { advanceFleet } = await rollout();
    await advanceFleet(NOW);
    expect((await advanceFleet(NOW + 10 * MINUTE)).failed).toBeUndefined();
    expect((await advanceFleet(NOW + 16 * MINUTE)).failed?.detail).toMatch(/had not succeeded after 15 minutes/);
  });
});

describe("a settings sync", () => {
  it("re-copies the template, keeps the bot's own gateway password, and redeploys the image it has", async () => {
    bot("wbotone1", B);
    fake.put("workspaces/wbotone1", { ...fake.read("workspaces/wbotone1"), release: { image: B, settingsGeneration: 0 } });
    fake.put("consoleFleet/release", { ...fleetDoc(), settingsGeneration: 1 });
    const { advanceFleet } = await rollout();
    expect((await advanceFleet(NOW)).started).toBe("wbotone1");
    expect(mutations()).toEqual(["writeVariables:svc-wbotone1", "deploy:svc-wbotone1"]);
    expect(railway.variables["svc-wbotone1"]).toMatchObject({
      R2_SECRET_ACCESS_KEY: "rotated-secret", GATEWAY_AUTH_TOKEN: "own-wbotone1", GENAIE_WORKSPACE_ID: "wbotone1" });

    railway.statuses["dep-1"] = "SUCCESS";
    await advanceFleet(NOW + MINUTE);
    await advanceFleet(NOW + 2 * MINUTE);
    expect(release("wbotone1")).toEqual({ image: B, settingsGeneration: 1 });
  });

  it("says plainly that re-copied settings cannot be taken back when the bot then fails", async () => {
    bot("wbotone1", B);
    fake.put("workspaces/wbotone1", { ...fake.read("workspaces/wbotone1"), release: { image: B, settingsGeneration: 0 } });
    fake.put("consoleFleet/release", { ...fleetDoc(), settingsGeneration: 1 });
    const { advanceFleet } = await rollout();
    await advanceFleet(NOW);
    railway.statuses["dep-1"] = "CRASHED";
    const summary = await advanceFleet(NOW + MINUTE);
    expect(summary.failed?.detail).toMatch(/re-copied settings stay: they cannot be restored/);
  });

  it("refuses a bot with no gateway password of its own rather than invent one", async () => {
    bot("wbotone1", B);
    railway.variables["svc-wbotone1"] = { ...TEMPLATE, GATEWAY_AUTH_TOKEN: "" };
    fake.put("workspaces/wbotone1", { ...fake.read("workspaces/wbotone1"), release: { image: B, settingsGeneration: 0 } });
    fake.put("consoleFleet/release", { ...fleetDoc(), settingsGeneration: 1 });
    const { advanceFleet } = await rollout();
    const summary = await advanceFleet(NOW);
    expect(mutations()).toEqual([]);
    expect(summary.waiting[0].reason).toMatch(/no gateway password of its own/);
  });
});
