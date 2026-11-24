import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVISION_STAGES, STAGE_MS } from "@/src/domains/bot-provisioning";
import { TEST_WORKSPACE } from "./auth-fixture";

/**
 * The development stub creates nothing, so what these pin is the part a real
 * provisioner must also get right: one run per workspace however many tabs ask,
 * and exactly one attempt to connect however many polls find it finished.
 */

const connect = vi.hoisted(() => vi.fn(async () => {}));
const stubUrl = vi.hoisted(() => ({ value: "" }));
vi.mock("@/src/lib/bot-connect", async (original) => ({
  ...await original<typeof import("@/src/lib/bot-connect")>(),
  connectBot: connect,
}));
vi.mock("@/src/config", async (original) => ({
  ...await original<typeof import("@/src/config")>(),
  get BOT_PROVISIONING_STUB_URL() { return stubUrl.value; },
}));

const WORKSPACE = { ...TEST_WORKSPACE, bot: null };
const WHOLE_RUN = STAGE_MS * PROVISION_STAGES.length;

async function stub() { return import("@/src/lib/bot-provisioning-stub"); }

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-24T09:00:00.000Z"));
  (await stub()).forgetProvisioningRuns();
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); stubUrl.value = ""; });

describe("a stubbed run", () => {
  it("is idle for a workspace that never started one", async () => {
    expect(await (await stub()).readProvisionState(WORKSPACE)).toEqual({ status: "idle" });
  });

  it("advances with the clock alone, with no timer to miss", async () => {
    const { startProvisioning, readProvisionState } = await stub();
    expect(await startProvisioning(WORKSPACE)).toMatchObject({ status: "running", stage: PROVISION_STAGES[0] });
    vi.advanceTimersByTime(STAGE_MS * 2);
    expect(await readProvisionState(WORKSPACE)).toMatchObject({ status: "running", stage: PROVISION_STAGES[2] });
  });

  it("joins the run already going rather than starting a second bot", async () => {
    const { startProvisioning } = await stub();
    const first = await startProvisioning(WORKSPACE);
    vi.advanceTimersByTime(STAGE_MS);
    const second = await startProvisioning(WORKSPACE);
    expect(second).toMatchObject({ status: "running", stage: PROVISION_STAGES[1] });
    expect(first).toMatchObject({ status: "running", stage: PROVISION_STAGES[0] });
  });

  it("says a run was simulated, and writes nothing, when there is no bot to connect", async () => {
    const { startProvisioning, readProvisionState } = await stub();
    await startProvisioning(WORKSPACE);
    vi.advanceTimersByTime(WHOLE_RUN);
    expect(await readProvisionState(WORKSPACE)).toMatchObject({ status: "ready", simulated: true });
    expect(connect).not.toHaveBeenCalled();
  });

  it("connects once however many polls find the run finished", async () => {
    stubUrl.value = "http://127.0.0.1:8080";
    const { startProvisioning, readProvisionState } = await stub();
    await startProvisioning(WORKSPACE);
    vi.advanceTimersByTime(WHOLE_RUN);
    const states = await Promise.all([
      readProvisionState(WORKSPACE), readProvisionState(WORKSPACE), readProvisionState(WORKSPACE),
    ]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(WORKSPACE, "http://127.0.0.1:8080");
    for (const state of states) expect(state).toMatchObject({ status: "ready" });
    expect(states[0]).not.toHaveProperty("simulated");
  });

  it("fails on the stage that failed, carrying the reason the bot gave", async () => {
    stubUrl.value = "http://127.0.0.1:8080";
    const { BotConnectError } = await import("@/src/lib/bot-connect");
    connect.mockRejectedValueOnce(new BotConnectError("Your bot refused this workspace's token."));
    const { startProvisioning, readProvisionState } = await stub();
    await startProvisioning(WORKSPACE);
    vi.advanceTimersByTime(WHOLE_RUN);
    expect(await readProvisionState(WORKSPACE)).toMatchObject({
      status: "failed",
      stage: PROVISION_STAGES[PROVISION_STAGES.length - 1],
      detail: "Your bot refused this workspace's token.",
    });
  });

  it("keeps each workspace's run to itself", async () => {
    const { startProvisioning, readProvisionState } = await stub();
    await startProvisioning(WORKSPACE);
    expect(await readProvisionState({ ...WORKSPACE, id: "another-workspace" })).toEqual({ status: "idle" });
  });
});
