import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVISION_STAGES, checkProvisionState, type ProvisionState } from "@/src/domains/bot-provisioning";
import { firestoreFake } from "./fixtures/firestore";
import { TEST_WORKSPACE } from "./auth-fixture";

/**
 * The real provisioner. What these pin is what costs money or data if it is
 * wrong: one service however many polls or tabs or retries, one step per poll,
 * and a workspace that is never pointed at a bot that is not serving it.
 */

const fake = firestoreFake();
vi.mock("@/src/lib/firebase-admin", () => ({ firestoreAdmin: () => fake.db }));

const railway = vi.hoisted(() => ({
  findService: vi.fn(async (): Promise<string | null> => null),
  createService: vi.fn(async () => "svc-1"),
  createVolume: vi.fn(async () => "vol-1"),
  createDomain: vi.fn(async () => ({ id: "dom-1", domain: "bot-new-production-ab12.up.railway.app" })),
  readTemplateVariables: vi.fn(async (): Promise<Record<string, string>> => ({ ...TEMPLATE })),
  writeVariables: vi.fn(async () => {}),
  setServiceSource: vi.fn(async () => {}),
  readLatestDeployment: vi.fn(async (): Promise<string | null> => "dep-1"),
  deployService: vi.fn(async () => "dep-2"),
  readDeploymentStatus: vi.fn(async () => "SUCCESS"),
}));
vi.mock("@/src/lib/railway-bot", () => ({
  ...railway,
  serviceName: (id: string) => `bot-${id}`,
}));

const bot = vi.hoisted(() => ({
  checkBot: vi.fn(async () => {}),
  connectBot: vi.fn(async () => {}),
}));
vi.mock("@/src/lib/bot-connect", async (original) => ({
  ...await original<typeof import("@/src/lib/bot-connect")>(),
  ...bot,
}));

const logged = vi.hoisted(() => ({ error: vi.fn() }));

const seeded = vi.hoisted(() => vi.fn(async () => "written" as const));
vi.mock("@/src/lib/workspace-seed", async (original) => ({
  ...await original<typeof import("@/src/lib/workspace-seed")>(),
  seedWorkspaceSettings: seeded,
}));

const TEMPLATE: Record<string, string> = {
  GCP_SERVICE_ACCOUNT_B64: "read-key", GCP_SERVICE_ACCOUNT_WRITE_B64: "write-key",
  R2_ACCOUNT_ID: "acct", R2_BUCKET: "bucket", R2_ACCESS_KEY_ID: "id",
  R2_SECRET_ACCESS_KEY: "a-shared-secret-nobody-should-see", OPENROUTER_API_KEY: "openrouter",
};

const WORKSPACE = { ...TEST_WORKSPACE, bot: null };
const PATH = `workspaces/${WORKSPACE.id}`;
const ORIGIN = "https://bot-new-production-ab12.up.railway.app";
const NOW = Date.parse("2026-11-25T09:00:00.000Z");

const provisioner = () => import("@/src/lib/bot-provisioning-railway");

/** Poll until the run is over, the way the screen does. */
async function drive(limit = 12): Promise<ProvisionState[]> {
  const { readProvisionState } = await provisioner();
  const seen: ProvisionState[] = [];
  for (let poll = 0; poll < limit; poll++) {
    const state = await readProvisionState(WORKSPACE);
    // Every answer must be one the browser would accept.
    checkProvisionState(state);
    seen.push(state);
    if (state.status === "ready" || state.status === "failed") break;
    vi.setSystemTime(Date.now() + 2_000);
  }
  return seen;
}

/** Poll until the run reaches a stage, so a test about one stage starts there. */
async function driveTo(stage: string): Promise<void> {
  const { readProvisionState } = await provisioner();
  for (let poll = 0; poll < 12; poll++) {
    const state = await readProvisionState(WORKSPACE);
    if (state.status === "running" && state.stage === stage) return;
    if (state.status !== "running") throw new Error(`the run ended before ${stage}`);
    vi.setSystemTime(Date.now() + 2_000);
  }
  throw new Error(`never reached ${stage}`);
}

const mutations = () =>
  railway.createService.mock.calls.length + railway.createVolume.mock.calls.length +
  railway.createDomain.mock.calls.length + railway.writeVariables.mock.calls.length +
  railway.setServiceSource.mock.calls.length + railway.deployService.mock.calls.length;

/** Everything the server log was told, as one string to search. */
const serverLog = () => JSON.stringify(logged.error.mock.calls);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  // The provisioner's own log. Stubbed rather than left alone: the tests below
  // read it, and a failing run would otherwise print through the test output.
  vi.spyOn(console, "error").mockImplementation(logged.error);
  vi.stubEnv("BOT_TOKEN_SECRET", "a-secret-long-enough-for-the-hmac-rule");
  fake.reset();
  fake.put(PATH, { name: "Test workspace", ownerUid: WORKSPACE.ownerUid, bot: null });
  // The config a new workspace is seeded from. The pre-flight reads it for real.
  fake.put("settings/defaults", { version: 1, caps_enabled: true, bands: [], contact_account: "ads" });
  railway.findService.mockResolvedValue(null);
  railway.createService.mockResolvedValue("svc-1");
  railway.createVolume.mockResolvedValue("vol-1");
  railway.createDomain.mockResolvedValue({ id: "dom-1", domain: "bot-new-production-ab12.up.railway.app" });
  railway.readTemplateVariables.mockResolvedValue({ ...TEMPLATE });
  railway.writeVariables.mockResolvedValue(undefined);
  railway.setServiceSource.mockResolvedValue(undefined);
  railway.readLatestDeployment.mockResolvedValue("dep-1");
  railway.deployService.mockResolvedValue("dep-2");
  railway.readDeploymentStatus.mockResolvedValue("SUCCESS");
  seeded.mockResolvedValue("written");
  bot.checkBot.mockResolvedValue(undefined);
  bot.connectBot.mockImplementation(async () => {
    fake.put(PATH, { ...fake.read(PATH), bot: { baseUrl: ORIGIN } });
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("a whole run", () => {
  it("is idle until something starts it", async () => {
    expect(await (await provisioner()).readProvisionState(WORKSPACE)).toEqual({ status: "idle" });
    expect(mutations()).toBe(0);
  });

  it("walks the four stages in order and connects the bot once", async () => {
    const { startProvisioning } = await provisioner();
    const started = await startProvisioning(WORKSPACE);
    expect(started).toMatchObject({ status: "running", stage: PROVISION_STAGES[0] });
    const seen = [started, ...await drive()];
    const stages = seen.flatMap((state) => (state.status === "running" ? [state.stage] : []));
    // Each stage is reached, in order, with no stage skipped or revisited.
    expect([...new Set(stages)]).toEqual([...PROVISION_STAGES]);
    expect(seen[seen.length - 1]).toMatchObject({ status: "ready" });
    expect(bot.connectBot).toHaveBeenCalledTimes(1);
    expect(bot.connectBot).toHaveBeenCalledWith(WORKSPACE, ORIGIN);
    expect(seeded).toHaveBeenCalledTimes(1);
  });

  it("builds exactly one of everything", async () => {
    await (await provisioner()).startProvisioning(WORKSPACE);
    await drive();
    expect(railway.createService).toHaveBeenCalledTimes(1);
    expect(railway.createVolume).toHaveBeenCalledTimes(1);
    expect(railway.createDomain).toHaveBeenCalledTimes(1);
    expect(railway.setServiceSource).toHaveBeenCalledTimes(1);
    // Setting the image IS the deploy on a first run, so nothing redeploys.
    expect(railway.deployService).not.toHaveBeenCalled();
  });

  it("gives the bot its image only once the volume, domain and config are there", async () => {
    await (await provisioner()).startProvisioning(WORKSPACE);
    await drive();
    // A service created WITH an image deploys at once, which would boot the bot
    // with no volume mounted and none of its config. So the image goes on last.
    const order = (call: { mock: { invocationCallOrder: number[] } }) => call.mock.invocationCallOrder[0];
    expect(order(railway.createService)).toBeLessThan(order(railway.createVolume));
    expect(order(railway.createVolume)).toBeLessThan(order(railway.createDomain));
    expect(order(railway.createDomain)).toBeLessThan(order(railway.writeVariables));
    expect(order(railway.writeVariables)).toBeLessThan(order(railway.setServiceSource));
  });

  it("watches the deployment that setting the image started", async () => {
    await (await provisioner()).startProvisioning(WORKSPACE);
    await drive();
    expect(railway.readDeploymentStatus).toHaveBeenCalledWith("dep-1");
  });

  it("keeps waiting when the deployment it started is not visible yet", async () => {
    railway.readLatestDeployment.mockResolvedValue(null);
    await (await provisioner()).startProvisioning(WORKSPACE);
    const seen = await drive(5);
    expect(seen[seen.length - 1]).toMatchObject({ status: "running" });
    // It must not set the image a second time while looking again.
    expect(railway.setServiceSource).toHaveBeenCalledTimes(1);
  });

  it("does one step per poll, so no poll can take minutes", async () => {
    const { startProvisioning, readProvisionState } = await provisioner();
    await startProvisioning(WORKSPACE);
    for (let poll = 0; poll < 6; poll++) {
      const before = mutations();
      const state = await readProvisionState(WORKSPACE);
      expect(mutations() - before).toBeLessThanOrEqual(3);
      if (state.status === "ready") break;
      vi.setSystemTime(Date.now() + 2_000);
    }
  });
});

describe("two tabs, two instances", () => {
  it("starts one run however many times it is asked", async () => {
    const { startProvisioning } = await provisioner();
    const first = await startProvisioning(WORKSPACE);
    const second = await startProvisioning(WORKSPACE);
    expect(second).toEqual(first);
  });

  it("lets a second poll report, not work, while another instance holds the lease", async () => {
    const { startProvisioning, readProvisionState } = await provisioner();
    const { claimRun } = await import("@/src/lib/provision-run");
    await startProvisioning(WORKSPACE);
    // Another instance is mid-step. This is exactly what it leaves behind.
    expect((await claimRun(WORKSPACE)).kind).toBe("claimed");
    expect(await readProvisionState(WORKSPACE)).toMatchObject({ status: "running", stage: "reserving" });
    expect(mutations()).toBe(0);
  });

  it("picks a run up once the instance holding it has gone quiet", async () => {
    const { startProvisioning, readProvisionState } = await provisioner();
    const { claimRun } = await import("@/src/lib/provision-run");
    const { LEASE_MS } = await import("@/src/domains/provision-run");
    await startProvisioning(WORKSPACE);
    await claimRun(WORKSPACE);
    vi.setSystemTime(Date.now() + LEASE_MS + 1);
    expect(await readProvisionState(WORKSPACE)).toMatchObject({ status: "running", stage: "starting" });
    expect(railway.createService).toHaveBeenCalledTimes(1);
  });
});

describe("a step that is re-entered", () => {
  it("reuses the ids it recorded and builds nothing twice", async () => {
    const { startProvisioning } = await provisioner();
    await startProvisioning(WORKSPACE);
    // The service and volume are made, then the domain call fails: the run
    // stops on reserving with two of its three ids written down.
    railway.createDomain.mockRejectedValueOnce(new Error("boom"));
    expect((await drive()).pop()).toMatchObject({ status: "failed", stage: "reserving" });
    expect(railway.createService).toHaveBeenCalledTimes(1);
    expect(railway.createVolume).toHaveBeenCalledTimes(1);

    await startProvisioning(WORKSPACE);
    expect((await drive()).pop()).toMatchObject({ status: "ready" });
    // Only the step that failed is done again.
    expect(railway.createService).toHaveBeenCalledTimes(1);
    expect(railway.createVolume).toHaveBeenCalledTimes(1);
    expect(railway.createDomain).toHaveBeenCalledTimes(2);
  });

  it("adopts a service it had not written down, rather than creating a second", async () => {
    const { startProvisioning, readProvisionState } = await provisioner();
    // What a crash between serviceCreate returning and the id being stored leaves.
    railway.findService.mockResolvedValue("svc-orphan");
    await startProvisioning(WORKSPACE);
    await readProvisionState(WORKSPACE);
    expect(railway.createService).not.toHaveBeenCalled();
    expect(railway.createVolume).toHaveBeenCalledWith("svc-orphan");
  });
});

describe("a run that goes wrong", () => {
  it("fails on starting when the deployment will not come up, and connects nothing", async () => {
    railway.readDeploymentStatus.mockResolvedValue("FAILED");
    await (await provisioner()).startProvisioning(WORKSPACE);
    const seen = await drive();
    expect(seen[seen.length - 1]).toMatchObject({ status: "failed", stage: "starting" });
    expect(bot.connectBot).not.toHaveBeenCalled();
    expect(fake.read(PATH)?.bot).toBeNull();
  });

  it("says a deployment is waiting to be approved rather than calling it broken", async () => {
    railway.readDeploymentStatus.mockResolvedValue("NEEDS_APPROVAL");
    await (await provisioner()).startProvisioning(WORKSPACE);
    const last = (await drive()).pop();
    expect(last).toMatchObject({ status: "failed" });
    if (last?.status === "failed") expect(last.detail).toMatch(/approved/);
  });

  it("keeps waiting while a deployment is still building", async () => {
    railway.readDeploymentStatus.mockResolvedValue("BUILDING");
    await (await provisioner()).startProvisioning(WORKSPACE);
    const seen = await drive(6);
    expect(seen[seen.length - 1]).toMatchObject({ status: "running", stage: "starting" });
    expect(bot.checkBot).not.toHaveBeenCalled();
  });

  it("treats a status it does not know as still working, never as success", async () => {
    railway.readDeploymentStatus.mockResolvedValue("SOMETHING_NEW");
    await (await provisioner()).startProvisioning(WORKSPACE);
    expect((await drive(6)).pop()).toMatchObject({ status: "running", stage: "starting" });
    expect(bot.connectBot).not.toHaveBeenCalled();
  });

  it("gives up on a run that has gone on too long", async () => {
    const { startProvisioning, readProvisionState } = await provisioner();
    const { RUN_DEADLINE_MS } = await import("@/src/domains/provision-run");
    railway.readDeploymentStatus.mockResolvedValue("DEPLOYING");
    await startProvisioning(WORKSPACE);
    await driveTo("starting");
    await drive(3);
    vi.setSystemTime(NOW + RUN_DEADLINE_MS + 1);
    expect(await readProvisionState(WORKSPACE)).toMatchObject({ status: "failed" });
  });

  it("adopts a deployment that succeeded while nobody was watching, rather than timing it out", async () => {
    const { startProvisioning, readProvisionState } = await provisioner();
    const { RUN_DEADLINE_MS } = await import("@/src/domains/provision-run");
    railway.readDeploymentStatus.mockResolvedValue("DEPLOYING");
    await startProvisioning(WORKSPACE);
    await driveTo("starting");
    await drive(3);
    // The user closed the tab for an hour. The deploy finished meanwhile.
    railway.readDeploymentStatus.mockResolvedValue("SUCCESS");
    vi.setSystemTime(NOW + RUN_DEADLINE_MS + 1);
    expect(await readProvisionState(WORKSPACE)).toMatchObject({ status: "running", stage: "seeding" });
  });

  it("never shows the user Railway's own words or a shared secret", async () => {
    railway.readDeploymentStatus.mockResolvedValue("CRASHED");
    await (await provisioner()).startProvisioning(WORKSPACE);
    const last = (await drive()).pop();
    if (last?.status !== "failed") throw new Error("expected a failure");
    expect(last.detail).not.toContain("a-shared-secret-nobody-should-see");
    expect(last.detail).not.toMatch(/CRASHED|railway/i);
  });
});

/**
 * The first real run, on 2026-11-26, failed with a true verdict -- Railway said
 * CRASHED and it had -- that the console then threw away, so the only way to
 * find out why was Railway's deploy log. These are about the record and the
 * server log that failure should have left, and about the user's sentence being
 * no different for them.
 */
describe("a failed run saying why", () => {
  it("writes Railway's verdict on a lost deployment down where the runbook looks", async () => {
    railway.readDeploymentStatus.mockResolvedValue("CRASHED");
    await (await provisioner()).startProvisioning(WORKSPACE);
    expect((await drive()).pop()).toMatchObject({ status: "failed", stage: "starting" });
    const stored = fake.read(PATH)?.provisioning as { railway?: Record<string, unknown> } | undefined;
    expect(stored?.railway).toMatchObject({ deploymentStatus: "CRASHED", deploymentId: "dep-1" });
    // The deployment id is what an operator opens in Railway, so it must have
    // survived alongside the verdict rather than been failed away.
    expect(stored?.railway?.serviceId).toBe("svc-1");
  });

  it("records the verdict for a deployment waiting to be approved too", async () => {
    railway.readDeploymentStatus.mockResolvedValue("NEEDS_APPROVAL");
    await (await provisioner()).startProvisioning(WORKSPACE);
    await drive();
    const stored = fake.read(PATH)?.provisioning as { railway?: Record<string, unknown> } | undefined;
    expect(stored?.railway?.deploymentStatus).toBe("NEEDS_APPROVAL");
  });

  it("logs the verdict with the ids needed to open that deployment in Railway", async () => {
    railway.readDeploymentStatus.mockResolvedValue("CRASHED");
    await (await provisioner()).startProvisioning(WORKSPACE);
    await drive();
    const log = serverLog();
    for (const wanted of ["CRASHED", "dep-1", "svc-1", WORKSPACE.id]) expect(log).toContain(wanted);
  });

  it("leaves the sentence the user reads exactly as it was", async () => {
    railway.readDeploymentStatus.mockResolvedValue("CRASHED");
    await (await provisioner()).startProvisioning(WORKSPACE);
    const last = (await drive()).pop();
    if (last?.status !== "failed") throw new Error("expected a failure");
    // Byte for byte. Recording the verdict is for the operator; nothing about
    // what the browser is handed changes, including that it holds no status.
    expect(last.detail).toBe(
      "Your bot was created but would not start. Nothing was connected to your workspace.");
    expect(JSON.stringify(last)).not.toContain("CRASHED");
  });

  it("logs what Railway said when a call is refused, and tells the browser none of it", async () => {
    const { RailwayError } = await import("@/src/lib/railway-api");
    railway.createVolume.mockRejectedValue(
      new RailwayError("Your bot's hosting refused a step of the setup.",
                       "Volume quota exceeded for project prj-7"));
    await (await provisioner()).startProvisioning(WORKSPACE);
    const last = (await drive()).pop();
    if (last?.status !== "failed") throw new Error("expected a failure");
    // The field railway-api documents as logged and never sent to a browser,
    // now actually logged.
    expect(serverLog()).toContain("Volume quota exceeded for project prj-7");
    expect(JSON.stringify(last)).not.toContain("quota");
    expect(last.detail).toBe("Your bot's hosting refused a step of the setup.");
  });

  it("drops the last attempt's verdict when the run is tried again", async () => {
    const { startProvisioning } = await provisioner();
    railway.readDeploymentStatus.mockResolvedValue("CRASHED");
    await startProvisioning(WORKSPACE);
    await drive();

    // A retry replaces the dead deployment, so its verdict must not linger and
    // send somebody after a deployment that is no longer the run's.
    railway.readDeploymentStatus.mockResolvedValue("SUCCESS");
    await startProvisioning(WORKSPACE);
    expect((await drive()).pop()).toMatchObject({ status: "ready" });
    const stored = fake.read(PATH)?.provisioning as { railway?: Record<string, unknown> } | undefined;
    expect(stored?.railway?.deploymentStatus).toBeUndefined();
  });
});

describe("trying again after a failure", () => {
  it("carries on from what the last attempt built, with one more deploy", async () => {
    const { startProvisioning, readProvisionState } = await provisioner();
    railway.readDeploymentStatus.mockResolvedValue("FAILED");
    await startProvisioning(WORKSPACE);
    await drive();
    expect(railway.createService).toHaveBeenCalledTimes(1);

    railway.readDeploymentStatus.mockResolvedValue("SUCCESS");
    expect(await startProvisioning(WORKSPACE)).toMatchObject({ status: "running" });
    expect((await drive()).pop()).toMatchObject({ status: "ready" });
    // The service, volume, domain and image are the first attempt's; only the
    // dead deployment is replaced.
    expect(railway.createService).toHaveBeenCalledTimes(1);
    expect(railway.createVolume).toHaveBeenCalledTimes(1);
    expect(railway.createDomain).toHaveBeenCalledTimes(1);
    expect(railway.setServiceSource).toHaveBeenCalledTimes(1);
    expect(railway.deployService).toHaveBeenCalledTimes(1);
  });

  it("does not poll the dead deployment's verdict for ever", async () => {
    const { startProvisioning } = await provisioner();
    railway.readDeploymentStatus.mockResolvedValue("FAILED");
    await startProvisioning(WORKSPACE);
    await drive();
    railway.deployService.mockResolvedValue("dep-retry");
    railway.readDeploymentStatus.mockResolvedValue("SUCCESS");
    await startProvisioning(WORKSPACE);
    await drive();
    expect(railway.readDeploymentStatus).toHaveBeenLastCalledWith("dep-retry");
  });
});

describe("before anything is built", () => {
  it("refuses when this console cannot read what a bot needs, and builds nothing", async () => {
    railway.readTemplateVariables.mockResolvedValue({ ...TEMPLATE, GCP_SERVICE_ACCOUNT_WRITE_B64: "" });
    const { startProvisioning } = await provisioner();
    await expect(startProvisioning(WORKSPACE)).rejects.toThrow();
    expect(mutations()).toBe(0);
    expect(fake.read(PATH)?.provisioning).toBeUndefined();
  });

  it("refuses when there is no config to seed a workspace from, and builds nothing", async () => {
    fake.reset();
    fake.put(PATH, { name: "Test workspace", ownerUid: WORKSPACE.ownerUid, bot: null });
    const { startProvisioning } = await provisioner();
    await expect(startProvisioning(WORKSPACE)).rejects.toThrow();
    expect(mutations()).toBe(0);
    expect(fake.read(PATH)?.provisioning).toBeUndefined();
  });

  it("names the value it could not read, without quoting any of them", async () => {
    railway.readTemplateVariables.mockResolvedValue({ ...TEMPLATE, R2_SECRET_ACCESS_KEY: "" });
    const { startProvisioning } = await provisioner();
    try {
      await startProvisioning(WORKSPACE);
      throw new Error("expected it to be refused");
    } catch (error) {
      const detail = (error as { detail?: string }).detail ?? "";
      expect(detail).toContain("R2_SECRET_ACCESS_KEY");
      expect(detail).not.toContain("a-shared-secret-nobody-should-see");
    }
  });
});

describe("connecting", () => {
  it("finishes a run whose registry write had already gone through", async () => {
    const { startProvisioning, readProvisionState } = await provisioner();
    bot.connectBot.mockImplementation(async () => { throw new Error("connectBot should not be called again"); });
    await startProvisioning(WORKSPACE);
    await driveTo("connecting");
    // The write landed, then the instance died before the run was saved.
    fake.put(PATH, { ...fake.read(PATH), bot: { baseUrl: ORIGIN } });
    const state = await readProvisionState(WORKSPACE);
    expect(state).toMatchObject({ status: "ready" });
    expect(bot.connectBot).not.toHaveBeenCalled();
  });

  it("refuses to take a workspace off the bot it is already on", async () => {
    const { startProvisioning, readProvisionState } = await provisioner();
    await startProvisioning(WORKSPACE);
    await driveTo("connecting");
    fake.put(PATH, { ...fake.read(PATH), bot: { baseUrl: "https://somebody-elses-bot.example" } });
    const state = await readProvisionState(WORKSPACE);
    expect(state).toMatchObject({ status: "failed", stage: "connecting" });
    expect(bot.connectBot).not.toHaveBeenCalled();
  });
});
