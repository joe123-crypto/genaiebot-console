import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./auth-fixture";

/**
 * The Railway calls a teardown makes, through the real transport. What these
 * pin is that an answer this console cannot read is a failure rather than an
 * absence: the teardown leaves alone what it does not find, so an entry it
 * could not read must never look like one that is not there.
 */

vi.mock("@/src/config", async (original) => ({
  ...await original<typeof import("@/src/config")>(),
  RAILWAY_PROVISIONING: {
    token: "railway-account-token", projectId: "proj-1", environmentId: "env-1", templateServiceId: "svc-template",
    image: "ghcr.io/example/bot:1", registry: null, mountPath: "/data", region: "europe-west4", port: 18790,
  },
}));

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

const answer = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ data }) }) as unknown as Response;
/** The variables the last request sent. */
const sent = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string) as { query: string; variables: Record<string, unknown> };
const api = () => import("@/src/lib/railway-bot");

const services = (...nodes: unknown[]) => ({ project: { services: { edges: nodes.map((node) => ({ node })) } } });
const volumes = (...nodes: unknown[]) => ({ environment: { volumeInstances: { edges: nodes.map((node) => ({ node })) } } });

describe("listing services", () => {
  it("reads every service in the configured project", async () => {
    fetchMock.mockResolvedValue(answer(services({ id: "svc-1", name: "bot-wTestWorkspace1" }, { id: "svc-2", name: "gateway" })));
    const { listServices, findService } = await api();
    expect(await listServices()).toEqual([{ id: "svc-1", name: "bot-wTestWorkspace1" }, { id: "svc-2", name: "gateway" }]);
    expect(sent().variables).toEqual({ projectId: "proj-1" });
    expect(await findService("gateway")).toBe("svc-2");
    expect(await findService("bot-nobody")).toBeNull();
  });

  it("fails rather than skip a service it cannot read", async () => {
    fetchMock.mockResolvedValue(answer(services({ id: "svc-1", name: "gateway" }, { id: null, name: "bot-wTestWorkspace1" })));
    const { listServices } = await api();
    await expect(listServices()).rejects.toThrow("could not read");
  });
});

describe("listing volumes", () => {
  it("reads the configured environment's instances, detached ones included", async () => {
    fetchMock.mockResolvedValue(answer(volumes(
      { volumeId: "vol-1", serviceId: "svc-1", isPendingDeletion: false },
      { volumeId: "vol-2", serviceId: null, isPendingDeletion: true },
    )));
    const { listVolumeInstances } = await api();
    expect(await listVolumeInstances()).toEqual([
      { volumeId: "vol-1", serviceId: "svc-1", pendingDeletion: false },
      { volumeId: "vol-2", serviceId: null, pendingDeletion: true },
    ]);
    expect(sent().variables).toEqual({ environmentId: "env-1" });
  });

  it("fails rather than guess whether a volume is going or whose it is", async () => {
    const { listVolumeInstances } = await api();
    fetchMock.mockResolvedValue(answer(volumes({ volumeId: "vol-1", serviceId: "svc-1" })));
    await expect(listVolumeInstances()).rejects.toThrow("could not read");
    fetchMock.mockResolvedValue(answer(volumes({ volumeId: "vol-1", serviceId: 7, isPendingDeletion: false })));
    await expect(listVolumeInstances()).rejects.toThrow("could not read");
  });
});

describe("deleting", () => {
  it("deletes a service in the configured environment, and believes only a yes", async () => {
    const { deleteService } = await api();
    fetchMock.mockResolvedValue(answer({ serviceDelete: true }));
    await deleteService("svc-1");
    expect(sent().variables).toEqual({ id: "svc-1", environmentId: "env-1" });
    expect(sent().query).toContain("serviceDelete");
    fetchMock.mockResolvedValue(answer({ serviceDelete: false }));
    await expect(deleteService("svc-1")).rejects.toThrow();
  });

  it("deletes a volume, and believes only a yes", async () => {
    const { deleteVolume } = await api();
    fetchMock.mockResolvedValue(answer({ volumeDelete: true }));
    await deleteVolume("vol-1");
    expect(sent().variables).toEqual({ volumeId: "vol-1" });
    fetchMock.mockResolvedValue(answer({ volumeDelete: null }));
    await expect(deleteVolume("vol-1")).rejects.toThrow();
  });
});
