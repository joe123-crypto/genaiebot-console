import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { firestoreFake } from "./fixtures/firestore";
import { TEST_WORKSPACE } from "./auth-fixture";
import type { ProvisionRun } from "@/src/domains/provision-run";

/**
 * Removing a workspace's bot with its account. What these pin is what costs
 * somebody else's bot or a month's bill if it is wrong: only this workspace's
 * service is deleted, never the template and never a volume mounted on anything
 * else; the volume is found before the service is deleted, because afterwards
 * nothing says whose it was; and a second attempt carries on from the first.
 */

const fake = firestoreFake();
vi.mock("@/src/lib/firebase-admin", () => ({ firestoreAdmin: () => fake.db }));

const config = vi.hoisted(() => ({
  railway: { templateServiceId: "svc-template" } as Record<string, unknown> | null,
}));
vi.mock("@/src/config", async (original) => {
  const actual = await original<typeof import("@/src/config")>();
  return Object.defineProperty({ ...actual }, "RAILWAY_PROVISIONING", { get: () => config.railway, enumerable: true });
});

type Volume = { volumeId: string; serviceId: string | null; pendingDeletion: boolean };
const railway = vi.hoisted(() => ({
  calls: [] as string[],
  services: [] as { id: string; name: string }[],
  volumes: [] as Volume[],
  failDeleteVolume: false,
}));
vi.mock("@/src/lib/railway-bot", () => ({
  serviceName: (id: string) => `bot-${id}`,
  listServices: vi.fn(async () => { railway.calls.push("listServices"); return railway.services.map((s) => ({ ...s })); }),
  listVolumeInstances: vi.fn(async () => { railway.calls.push("listVolumes"); return railway.volumes.map((v) => ({ ...v })); }),
  deleteService: vi.fn(async (id: string) => {
    railway.calls.push(`deleteService:${id}`);
    railway.services = railway.services.filter((s) => s.id !== id);
    // Measured: the volume stays, and forgets which service it was on.
    for (const volume of railway.volumes) if (volume.serviceId === id) volume.serviceId = null;
  }),
  deleteVolume: vi.fn(async (id: string) => {
    railway.calls.push(`deleteVolume:${id}`);
    if (railway.failDeleteVolume) throw new Error("railway down");
    for (const volume of railway.volumes) if (volume.volumeId === id) volume.pendingDeletion = true;
  }),
}));

const ID = TEST_WORKSPACE.id;
const OURS = `bot-${ID}`;
const teardown = () => import("@/src/lib/bot-teardown");

function run(railwayIds: ProvisionRun["railway"]): ProvisionRun {
  return {
    stage: "starting", outcome: "failed", startedAt: "2026-11-26T09:00:00.000Z", updatedAt: "2026-11-26T09:05:00.000Z",
    attempt: 1, detail: "Your bot was created but would not start.", railway: railwayIds,
  };
}

beforeEach(() => {
  fake.reset();
  config.railway = { templateServiceId: "svc-template" };
  railway.calls = [];
  railway.failDeleteVolume = false;
  railway.services = [
    { id: "svc-template", name: "gateway" },
    { id: "svc-other", name: "bot-someoneelse1" },
    { id: "svc-1", name: OURS },
  ];
  railway.volumes = [
    { volumeId: "vol-template", serviceId: "svc-template", pendingDeletion: false },
    { volumeId: "vol-other", serviceId: "svc-other", pendingDeletion: false },
    { volumeId: "vol-1", serviceId: "svc-1", pendingDeletion: false },
  ];
});
afterEach(() => { vi.restoreAllMocks(); });

describe("removing the bot this console built", () => {
  it("reads the volumes first, then deletes the service, then its volume", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { removeProvisionedBot } = await teardown();
    const removed = await removeProvisionedBot(ID, run({ serviceId: "svc-1", volumeId: "vol-1" }));
    expect(removed).toEqual({ services: ["svc-1"], volumes: ["vol-1"] });
    expect(railway.calls).toEqual(["listServices", "listVolumes", "deleteService:svc-1", "deleteVolume:vol-1"]);
  });

  it("finds a service the record never named, as a crash before its id was written would leave", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { removeProvisionedBot } = await teardown();
    await removeProvisionedBot(ID, null);
    expect(railway.calls).toContain("deleteService:svc-1");
    expect(railway.calls).toContain("deleteVolume:vol-1");
  });

  it("never touches another workspace's bot, the template, or a volume mounted on either", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { removeProvisionedBot } = await teardown();
    // A record pointing at a detached volume that is in fact still mounted on
    // somebody else's service: the mount wins over the record.
    await removeProvisionedBot(ID, run({ serviceId: "svc-1", volumeId: "vol-other" }));
    const deleted = railway.calls.filter((call) => call.startsWith("delete"));
    expect(deleted).toEqual(["deleteService:svc-1", "deleteVolume:vol-1"]);
  });

  it("never deletes the template, even when it carries this workspace's name", async () => {
    railway.services = [{ id: "svc-template", name: OURS }];
    railway.volumes = [{ volumeId: "vol-template", serviceId: "svc-template", pendingDeletion: false }];
    const { removeProvisionedBot } = await teardown();
    expect(await removeProvisionedBot(ID, null)).toEqual({ services: [], volumes: [] });
    expect(railway.calls.filter((call) => call.startsWith("delete"))).toEqual([]);
  });

  it("refuses rather than guesses when the record names a service under another name", async () => {
    const { removeProvisionedBot, BotTeardownError } = await teardown();
    await expect(removeProvisionedBot(ID, run({ serviceId: "svc-other" }))).rejects.toBeInstanceOf(BotTeardownError);
    expect(railway.calls.filter((call) => call.startsWith("delete"))).toEqual([]);
  });

  it("carries on from a first attempt that deleted the service and then failed", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { removeProvisionedBot } = await teardown();
    railway.failDeleteVolume = true;
    await expect(removeProvisionedBot(ID, run({ serviceId: "svc-1", volumeId: "vol-1" }))).rejects.toThrow();
    railway.failDeleteVolume = false;
    railway.calls = [];
    // The service is gone and its volume is detached; only the record knows it.
    const removed = await removeProvisionedBot(ID, run({ serviceId: "svc-1", volumeId: "vol-1" }));
    expect(removed).toEqual({ services: [], volumes: ["vol-1"] });
    expect(railway.calls).toEqual(["listServices", "listVolumes", "deleteVolume:vol-1"]);
  });

  it("does nothing a second time once everything is gone or going", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { removeProvisionedBot } = await teardown();
    await removeProvisionedBot(ID, run({ serviceId: "svc-1", volumeId: "vol-1" }));
    railway.calls = [];
    expect(await removeProvisionedBot(ID, run({ serviceId: "svc-1", volumeId: "vol-1" }))).toEqual({ services: [], volumes: [] });
    expect(railway.calls).toEqual(["listServices", "listVolumes"]);
  });

  it("has nothing to do for a workspace this console never built a bot for", async () => {
    railway.services = railway.services.filter((service) => service.id !== "svc-1");
    const { removeProvisionedBot } = await teardown();
    expect(await removeProvisionedBot(ID, null)).toEqual({ services: [], volumes: [] });
  });
});

describe("a console without Railway credentials", () => {
  it("refuses when the record says it built something, rather than orphan it", async () => {
    config.railway = null;
    const { removeProvisionedBot, BotTeardownError } = await teardown();
    await expect(removeProvisionedBot(ID, run({ serviceId: "svc-1" }))).rejects.toBeInstanceOf(BotTeardownError);
    expect(railway.calls).toEqual([]);
  });

  it("has nothing to remove when it never built anything", async () => {
    config.railway = null;
    const { removeProvisionedBot } = await teardown();
    expect(await removeProvisionedBot(ID, run({}))).toEqual({ services: [], volumes: [] });
    expect(await removeProvisionedBot(ID, null)).toEqual({ services: [], volumes: [] });
    expect(railway.calls).toEqual([]);
  });
});

describe("what the card is told about the bot", () => {
  const PATH = `workspaces/${ID}`;
  const stored = { stage: "connecting", outcome: "ready", startedAt: "2026-11-26T09:00:00.000Z",
    updatedAt: "2026-11-26T09:05:00.000Z", attempt: 1, railway: { serviceId: "svc-1" } };

  it("is removed for a workspace this console started a run for", async () => {
    fake.put(PATH, { ownerUid: TEST_WORKSPACE.ownerUid, provisioning: stored });
    const { botRemovalOf } = await teardown();
    expect(await botRemovalOf(TEST_WORKSPACE)).toBe("removed");
  });

  it("is manual for a bot connected by hand, and none without a bot", async () => {
    fake.put(PATH, { ownerUid: TEST_WORKSPACE.ownerUid });
    const { botRemovalOf } = await teardown();
    expect(await botRemovalOf(TEST_WORKSPACE)).toBe("manual");
    expect(await botRemovalOf({ ...TEST_WORKSPACE, bot: null })).toBe("none");
    expect(await botRemovalOf(null)).toBe("none");
  });

  it("answers from the registry when the record cannot be read, rather than failing the page", async () => {
    fake.put(PATH, { ownerUid: TEST_WORKSPACE.ownerUid, provisioning: stored });
    fake.fail(true);
    const { botRemovalOf } = await teardown();
    expect(await botRemovalOf(TEST_WORKSPACE)).toBe("manual");
  });
});
