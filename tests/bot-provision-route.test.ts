import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/bot/provision/route";
import { TEST_WORKSPACE } from "./auth-fixture";
import { getWorkspace, holdOnboardingOpen } from "@/src/lib/workspace";
import type { ProvisionState } from "@/src/domains/bot-provisioning";

/**
 * The HTTP boundary of creating a bot. Which workspace is never asked for, so
 * the checks that matter are the ones the accounts route already makes: a
 * session, same-origin, a body this route recognises, and nothing cacheable.
 */

const state = vi.hoisted(() => ({
  read: vi.fn<() => Promise<ProvisionState>>(async () => ({ status: "idle" })),
  start: vi.fn<() => Promise<ProvisionState>>(async () =>
    ({ status: "running", stage: "reserving", startedAt: "2026-11-24T09:00:00.000Z" })),
  enabled: true,
}));
vi.mock("@/src/lib/bot-provisioning", () => ({
  provisioningEnabled: () => state.enabled,
  readProvisionState: state.read,
  startProvisioning: state.start,
}));

const BOTLESS = { ...TEST_WORKSPACE, bot: null };
const post = (body = "{}", origin = "http://localhost:3000", type = "application/json") =>
  POST(new Request("http://localhost:3000/api/bot/provision", {
    method: "POST", headers: { origin, "content-type": type }, body,
  }));

beforeEach(() => { vi.mocked(getWorkspace).mockResolvedValue(BOTLESS); });
afterEach(() => { vi.clearAllMocks(); state.enabled = true; });

describe("creating a bot over HTTP", () => {
  it("keeps a pre-onboarding workspace's wizard open before starting its bot, and only on a valid start", async () => {
    expect((await post('{"workspace":"someone-else"}')).status).toBe(400);
    expect(holdOnboardingOpen).not.toHaveBeenCalled();
    expect((await post()).status).toBe(200);
    expect(holdOnboardingOpen).toHaveBeenCalledWith(BOTLESS);
    expect(vi.mocked(holdOnboardingOpen).mock.invocationCallOrder[0]).toBeLessThan(state.start.mock.invocationCallOrder[0]);
  });

  it("says so plainly when this console cannot create one, and starts nothing", async () => {
    state.enabled = false;
    expect((await GET()).status).toBe(503);
    expect((await post()).status).toBe(503);
    expect(state.start).not.toHaveBeenCalled();
  });

  it("rejects cross-origin starts before reaching the provisioner", async () => {
    expect((await post("{}", "https://another-site.example")).status).toBe(403);
    expect(state.start).not.toHaveBeenCalled();
  });

  it("uses the browser-facing host when Next supplies an internal bind URL", async () => {
    const request = new Request("http://localhost:3107/api/bot/provision", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3107", host: "127.0.0.1:3107", "content-type": "application/json" },
      body: "{}",
    });
    expect((await POST(request)).status).toBe(200);
  });

  it("refuses malformed, extra-field and oversized bodies", async () => {
    expect((await post("{}", "http://localhost:3000", "text/plain")).status).toBe(400);
    expect((await post("{bad")).status).toBe(400);
    expect((await post('{"workspace":"someone-else"}')).status).toBe(400);
    expect((await post("[]")).status).toBe(400);
    expect((await post(" ".repeat(2049))).status).toBe(413);
    expect(state.start).not.toHaveBeenCalled();
  });

  it("never takes the workspace from the caller", async () => {
    await post("{}");
    expect(state.start).toHaveBeenCalledWith(BOTLESS);
  });

  it("reports a run, and marks every answer uncacheable", async () => {
    state.read.mockResolvedValue({ status: "running", stage: "seeding", startedAt: "2026-11-24T09:00:00.000Z" });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "running", stage: "seeding", startedAt: "2026-11-24T09:00:00.000Z" });
  });

  it("answers a signed-out request without asking the provisioner anything", async () => {
    vi.mocked(getWorkspace).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(state.read).not.toHaveBeenCalled();
  });

  it("explains an unreachable registry rather than guessing", async () => {
    const { WorkspaceUnavailableError } = await import("@/src/lib/workspace");
    state.read.mockRejectedValue(new WorkspaceUnavailableError());
    expect((await GET()).status).toBe(503);
  });
});

describe("what a failed run is answered with", () => {
  it("shows a refused handshake's own words rather than calling it a breakage", async () => {
    const { BotConnectError } = await import("@/src/lib/bot-connect");
    state.read.mockRejectedValue(new BotConnectError("Your bot refused this workspace's token."));
    const response = await GET();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Your bot refused this workspace's token." });
  });

  it("shows a provisioner's own detail, with its own status", async () => {
    const { BotUnavailableError } = await import("@/src/lib/bot-errors");
    state.read.mockRejectedValue(new BotUnavailableError("This console cannot read the settings a new bot needs.", 503));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "This console cannot read the settings a new bot needs." });
  });

  it("never passes an unrecognised failure's words on", async () => {
    state.read.mockRejectedValue(new Error("Railway said: no access with token sk-live-123"));
    const response = await GET();
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("sk-live-123");
  });
});
