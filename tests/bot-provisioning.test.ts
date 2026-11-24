import { describe, expect, it } from "vitest";
import {
  PROVISION_STAGES,
  STAGE_MS,
  checkProvisionState,
  isTerminal,
  stageStatus,
  stateFromElapsed,
} from "@/src/domains/bot-provisioning";

/**
 * A run is one instant plus the clock, so a reload, a second tab and the server
 * all answer the same thing. These pin the stage boundaries that promise says,
 * and that the screen never draws a payload it did not recognise.
 */

const START = Date.parse("2026-11-24T09:00:00.000Z");

describe("a run's stage", () => {
  it("starts on the first stage and reaches each one in turn", () => {
    for (const [index, stage] of PROVISION_STAGES.entries()) {
      const state = stateFromElapsed(START, START + STAGE_MS * index);
      expect(state).toMatchObject({ status: "running", stage });
    }
  });

  it("stays on a stage until its last millisecond", () => {
    expect(stateFromElapsed(START, START + STAGE_MS - 1)).toMatchObject({ status: "running", stage: PROVISION_STAGES[0] });
    expect(stateFromElapsed(START, START + STAGE_MS)).toMatchObject({ status: "running", stage: PROVISION_STAGES[1] });
  });

  it("is ready once the last stage is behind it, and stays ready", () => {
    const whole = STAGE_MS * PROVISION_STAGES.length;
    expect(stateFromElapsed(START, START + whole)).toMatchObject({ status: "ready" });
    expect(stateFromElapsed(START, START + whole * 10)).toMatchObject({ status: "ready" });
  });

  it("treats a clock that has gone backwards as the very beginning", () => {
    expect(stateFromElapsed(START, START - 60_000)).toMatchObject({ status: "running", stage: PROVISION_STAGES[0] });
  });
});

describe("what the step list draws", () => {
  const running = { status: "running", stage: "seeding", startedAt: new Date(START).toISOString() } as const;

  it("marks the stages behind as done, the one reached as current, the rest as pending", () => {
    expect(stageStatus(running, "reserving")).toBe("done");
    expect(stageStatus(running, "starting")).toBe("done");
    expect(stageStatus(running, "seeding")).toBe("current");
    expect(stageStatus(running, "connecting")).toBe("pending");
  });

  it("marks the stage a run failed on, and leaves the ones it never reached pending", () => {
    const failed = { status: "failed", stage: "seeding", detail: "nope", failedAt: new Date(START).toISOString() } as const;
    expect(stageStatus(failed, "starting")).toBe("done");
    expect(stageStatus(failed, "seeding")).toBe("failed");
    expect(stageStatus(failed, "connecting")).toBe("pending");
  });

  it("shows every stage done once the run is ready, and none before it starts", () => {
    const ready = { status: "ready", readyAt: new Date(START).toISOString() } as const;
    for (const stage of PROVISION_STAGES) {
      expect(stageStatus(ready, stage)).toBe("done");
      expect(stageStatus({ status: "idle" }, stage)).toBe("pending");
    }
  });

  it("knows which runs are over", () => {
    expect(isTerminal({ status: "idle" })).toBe(false);
    expect(isTerminal(running)).toBe(false);
    expect(isTerminal({ status: "ready", readyAt: new Date(START).toISOString() })).toBe(true);
    expect(isTerminal({ status: "failed", stage: "seeding", detail: "nope", failedAt: new Date(START).toISOString() })).toBe(true);
  });
});

describe("the state the browser will accept", () => {
  const stamp = new Date(START).toISOString();

  it("keeps a well-formed state, and the simulated marker only when it is set", () => {
    expect(checkProvisionState({ status: "idle" })).toEqual({ status: "idle" });
    expect(checkProvisionState({ status: "running", stage: "starting", startedAt: stamp }))
      .toEqual({ status: "running", stage: "starting", startedAt: stamp });
    expect(checkProvisionState({ status: "ready", readyAt: stamp })).toEqual({ status: "ready", readyAt: stamp });
    expect(checkProvisionState({ status: "ready", readyAt: stamp, simulated: true }))
      .toEqual({ status: "ready", readyAt: stamp, simulated: true });
    expect(checkProvisionState({ status: "ready", readyAt: stamp, simulated: "yes" })).toEqual({ status: "ready", readyAt: stamp });
  });

  it("refuses anything it could only guess at", () => {
    for (const value of [null, undefined, [], "ready", 7,
                         { status: "done" },
                         { status: "running", stage: "mining", startedAt: stamp },
                         { status: "running", stage: "starting", startedAt: "whenever" },
                         { status: "running", stage: "starting" },
                         { status: "ready" },
                         { status: "failed", stage: "seeding", failedAt: stamp },
                         { status: "failed", stage: "seeding", detail: "   ", failedAt: stamp }]) {
      expect(() => checkProvisionState(value)).toThrow(/setup status/);
    }
  });

  it("caps a failure's detail rather than letting the bot size the screen", () => {
    const state = checkProvisionState({ status: "failed", stage: "seeding", detail: "x".repeat(900), failedAt: stamp });
    expect(state).toMatchObject({ status: "failed" });
    if (state.status === "failed") expect(state.detail).toHaveLength(400);
  });
});
