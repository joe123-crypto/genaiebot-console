import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkProvisionState } from "@/src/domains/bot-provisioning";
import { firestoreFake } from "./fixtures/firestore";
import { TEST_WORKSPACE } from "./auth-fixture";

/**
 * The run record and its lease: the part that has to be right for two polls on
 * two instances not to build two bots, and for a poll that dies mid-step to
 * leave a run somebody else can pick up.
 */

const fake = firestoreFake();
vi.mock("@/src/lib/firebase-admin", () => ({ firestoreAdmin: () => fake.db }));

const WORKSPACE = { ...TEST_WORKSPACE, bot: null };
const PATH = `workspaces/${WORKSPACE.id}`;
const NOW = Date.parse("2026-11-25T09:00:00.000Z");

const store = () => import("@/src/lib/provision-run");
const domain = () => import("@/src/domains/provision-run");

beforeEach(() => {
  fake.reset();
  fake.put(PATH, { name: "Test workspace", ownerUid: WORKSPACE.ownerUid, bot: null });
});

describe("what the screen is told", () => {
  it("is a state the browser accepts, whatever the run says", async () => {
    const { newRun, failedRun, readyRun, runState } = await domain();
    const run = newRun(NOW);
    for (const value of [run, readyRun(run, NOW), failedRun(run, "no image", NOW)]) {
      expect(() => checkProvisionState(runState(value))).not.toThrow();
    }
  });

  it("never hands the screen a failure with nothing to say", async () => {
    const { newRun, failedRun, runState } = await domain();
    const state = runState(failedRun(newRun(NOW), "   ", NOW));
    expect(() => checkProvisionState(state)).not.toThrow();
    expect(state).toMatchObject({ status: "failed" });
  });

  it("caps a failure so the stored detail cannot outgrow the screen's", async () => {
    const { newRun, failedRun } = await domain();
    expect(failedRun(newRun(NOW), "x".repeat(900), NOW).detail).toHaveLength(400);
  });
});

describe("reading a stored run", () => {
  it("refuses a record it cannot read rather than guessing at one", async () => {
    const { parseRun, newRun } = await domain();
    const run = newRun(NOW);
    for (const value of [null, undefined, [], "running", { ...run, stage: "mining" },
                         { ...run, outcome: "done" }, { ...run, startedAt: "whenever" },
                         { ...run, outcome: "failed" }]) {
      expect(parseRun(value)).toBeNull();
    }
  });

  it("keeps the ids a re-entered step depends on", async () => {
    const { parseRun, newRun } = await domain();
    const stored = { ...newRun(NOW), railway: { serviceId: "svc", volumeId: "vol", domain: "bot.up.railway.app",
                                                deploymentAttempt: 2, variablesAt: new Date(NOW).toISOString() } };
    expect(parseRun(stored)?.railway).toMatchObject({ serviceId: "svc", volumeId: "vol", deploymentAttempt: 2 });
  });

  it("keeps the verdict a lost deployment left, which is what says why a run failed", async () => {
    const { parseRun, newRun } = await domain();
    const stored = { ...newRun(NOW), railway: { deploymentId: "dep-1", deploymentStatus: "CRASHED" } };
    expect(parseRun(stored)?.railway).toMatchObject({ deploymentId: "dep-1", deploymentStatus: "CRASHED" });
  });
});

describe("starting a run", () => {
  it("creates one run, and a second ask joins it", async () => {
    const { startRun } = await store();
    const first = await startRun(WORKSPACE, NOW);
    const second = await startRun(WORKSPACE, NOW + 1_000);
    expect(first.attempt).toBe(1);
    expect(second).toEqual(first);
  });

  it("re-arms a failed run, keeping what it already built", async () => {
    const { startRun, saveRun } = await store();
    const { failedRun } = await domain();
    const opened = await startRun(WORKSPACE, NOW);
    await saveRun(WORKSPACE, failedRun({ ...opened, stage: "starting", railway: { serviceId: "svc" } },
                                       "would not start", NOW));
    const again = await startRun(WORKSPACE, NOW + 60_000);
    expect(again).toMatchObject({ outcome: "running", stage: "starting", attempt: 2 });
    expect(again.railway.serviceId).toBe("svc");
    expect(again.detail).toBeUndefined();
  });

  it("stores a lost deployment's verdict, and does not carry it into the next attempt", async () => {
    const { startRun, saveRun } = await store();
    const { failedRun, withResources } = await domain();
    const opened = await startRun(WORKSPACE, NOW);
    const lost = withResources({ ...opened, stage: "starting" },
                               { serviceId: "svc", deploymentId: "dep-1", deploymentStatus: "CRASHED" }, NOW);
    await saveRun(WORKSPACE, failedRun(lost, "would not start", NOW));
    const failed = fake.read(PATH)?.provisioning as { railway?: Record<string, unknown> } | undefined;
    expect(failed?.railway).toMatchObject({ deploymentId: "dep-1", deploymentStatus: "CRASHED" });

    const again = await startRun(WORKSPACE, NOW + 60_000);
    expect(again.railway.serviceId).toBe("svc");
    expect(again.railway.deploymentStatus).toBeUndefined();
    // Absent, not present and undefined: Firestore refuses an undefined value,
    // so a verdict that is dropped has to be dropped from the document too.
    const rearmed = fake.read(PATH)?.provisioning as { railway?: Record<string, unknown> } | undefined;
    expect(rearmed?.railway && "deploymentStatus" in rearmed.railway).toBe(false);
  });
});

describe("the lease", () => {
  it("is taken once; a second poll is told to report, not to work", async () => {
    const { startRun, claimRun } = await store();
    await startRun(WORKSPACE, NOW);
    expect((await claimRun(WORKSPACE, NOW)).kind).toBe("claimed");
    expect((await claimRun(WORKSPACE, NOW + 1_000)).kind).toBe("busy");
  });

  it("is takeable again once it has expired, on the same stage", async () => {
    const { startRun, claimRun } = await store();
    const { LEASE_MS } = await domain();
    await startRun(WORKSPACE, NOW);
    const first = await claimRun(WORKSPACE, NOW);
    const later = await claimRun(WORKSPACE, NOW + LEASE_MS + 1);
    expect(later.kind).toBe("claimed");
    if (first.kind === "claimed" && later.kind === "claimed") {
      expect(later.run.stage).toBe(first.run.stage);
      expect(later.run.lease?.holder).not.toBe(first.run.lease?.holder);
    }
  });

  it("is not taken for a run that is already over", async () => {
    const { startRun, saveRun, claimRun } = await store();
    const { readyRun } = await domain();
    const opened = await startRun(WORKSPACE, NOW);
    await saveRun(WORKSPACE, readyRun(opened, NOW));
    expect((await claimRun(WORKSPACE, NOW + 1)).kind).toBe("busy");
  });

  it("is released by the holder, and the run keeps where it got to", async () => {
    const { startRun, claimRun, saveRun, readRun } = await store();
    const { atStage } = await domain();
    await startRun(WORKSPACE, NOW);
    const claim = await claimRun(WORKSPACE, NOW);
    if (claim.kind !== "claimed") throw new Error("expected a claim");
    await saveRun(WORKSPACE, atStage(claim.run, "seeding", NOW));
    const stored = await readRun(WORKSPACE);
    expect(stored).toMatchObject({ stage: "seeding" });
    expect(stored?.lease).toBeUndefined();
  });

  it("ignores a write from a holder that lost it, so the run stays with whoever has it", async () => {
    const { startRun, claimRun, saveRun, readRun } = await store();
    const { LEASE_MS, atStage } = await domain();
    await startRun(WORKSPACE, NOW);
    const first = await claimRun(WORKSPACE, NOW);
    const second = await claimRun(WORKSPACE, NOW + LEASE_MS + 1);
    if (first.kind !== "claimed" || second.kind !== "claimed") throw new Error("expected two claims");
    // The instance that overran comes back and tries to finish its step.
    await saveRun(WORKSPACE, atStage(first.run, "connecting", NOW));
    const stored = await readRun(WORKSPACE);
    expect(stored?.stage).toBe("reserving");
    expect(stored?.lease?.holder).toBe(second.run.lease?.holder);
  });
});

describe("deleting the account", () => {
  it("hands back the run record and fences provisioning off", async () => {
    const { startRun, beginDeletion, claimRun } = await store();
    await startRun(WORKSPACE, NOW);
    const run = await beginDeletion(WORKSPACE, NOW + 1_000);
    expect(run).toMatchObject({ stage: "reserving", outcome: "running" });
    expect(fake.read(PATH)?.deletingAt).toBe(new Date(NOW + 1_000).toISOString());
    // A poll arriving now reports, and builds nothing.
    expect((await claimRun(WORKSPACE, NOW + 2_000)).kind).toBe("busy");
  });

  it("refuses to start or re-arm a run while the account is being deleted", async () => {
    const { beginDeletion, startRun } = await store();
    await beginDeletion(WORKSPACE, NOW);
    await expect(startRun(WORKSPACE, NOW + 1_000)).rejects.toMatchObject({ detail: expect.stringContaining("being deleted") });
    expect(fake.read(PATH)?.provisioning).toBeUndefined();
  });

  it("waits for a step that holds the lease, which may be creating something this instant", async () => {
    const { startRun, claimRun, beginDeletion, ProvisioningBusyError } = await store();
    await startRun(WORKSPACE, NOW);
    expect((await claimRun(WORKSPACE, NOW)).kind).toBe("claimed");
    await expect(beginDeletion(WORKSPACE, NOW + 1_000)).rejects.toBeInstanceOf(ProvisioningBusyError);
    expect(fake.read(PATH)?.deletingAt).toBeUndefined();
  });

  it("goes ahead once that lease has run out", async () => {
    const { startRun, claimRun, beginDeletion } = await store();
    const { LEASE_MS } = await domain();
    await startRun(WORKSPACE, NOW);
    await claimRun(WORKSPACE, NOW);
    await expect(beginDeletion(WORKSPACE, NOW + LEASE_MS + 1)).resolves.toMatchObject({ outcome: "running" });
  });

  it("has no record to hand back for a workspace that never ran one", async () => {
    const { beginDeletion } = await store();
    expect(await beginDeletion(WORKSPACE, NOW)).toBeNull();
  });

  it("stops fencing once it is old, so an abandoned deletion does not freeze /setup", async () => {
    const { beginDeletion, startRun } = await store();
    const { DELETION_FENCE_MS } = await domain();
    await beginDeletion(WORKSPACE, NOW);
    await expect(startRun(WORKSPACE, NOW + DELETION_FENCE_MS + 1)).resolves.toMatchObject({ outcome: "running" });
  });
});

describe("a record this console cannot read", () => {
  it("is not reported as no run at all: a live service may be behind it", async () => {
    const { claimRun } = await store();
    fake.put(PATH, { ownerUid: WORKSPACE.ownerUid, bot: null, provisioning: { stage: "mining" } });
    expect((await claimRun(WORKSPACE, NOW)).kind).toBe("broken");
  });

  it("is distinguished from a workspace that has never run one", async () => {
    const { claimRun } = await store();
    expect((await claimRun(WORKSPACE, NOW)).kind).toBe("none");
  });

  it("is not started over, which would build a second volume and bill for it", async () => {
    const { startRun } = await store();
    const broken = { stage: "mining", railway: { serviceId: "svc", volumeId: "vol" } };
    fake.put(PATH, { ownerUid: WORKSPACE.ownerUid, bot: null, provisioning: broken });
    await expect(startRun(WORKSPACE, NOW)).rejects.toThrow();
    expect(fake.read(PATH)?.provisioning).toEqual(broken);
  });
});
