import { beforeEach, describe, expect, it, vi } from "vitest";
import { firestoreFake } from "./fixtures/firestore";
import "./auth-fixture";

/**
 * The two routes automation calls. Each has its own token, so the job that may
 * promote a release cannot also drive the rollout; and the release route takes
 * only a commit build of the repository bots are created from.
 */

const fake = firestoreFake();
vi.mock("@/src/lib/firebase-admin", () => ({ firestoreAdmin: () => fake.db }));
vi.mock("@/src/config", async (original) => ({
  ...await original<typeof import("@/src/config")>(),
  RAILWAY_PROVISIONING: { image: `ghcr.io/joe123-crypto/genaebot:${"f".repeat(40)}` },
}));
const tick = vi.hoisted(() => ({ advanceFleet: vi.fn() }));
vi.mock("@/src/lib/fleet-rollout", () => tick);

const RELEASE_TOKEN = "r".repeat(40);
const TICK_TOKEN = "t".repeat(40);
const IMAGE = `ghcr.io/joe123-crypto/genaebot:${"a".repeat(40)}`;

const post = (path: string, token?: string, body?: unknown) => new Request(`https://console.example${path}`, {
  method: "POST", body: body === undefined ? undefined : JSON.stringify(body),
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
});
const release = async (token?: string, body: unknown = { image: IMAGE }) =>
  (await import("@/app/api/internal/fleet/release/route")).POST(post("/api/internal/fleet/release", token, body));
const advance = async (token?: string) =>
  (await import("@/app/api/internal/fleet/tick/route")).POST(post("/api/internal/fleet/tick", token));

beforeEach(() => {
  fake.reset();
  vi.stubEnv("FLEET_RELEASE_TOKEN", RELEASE_TOKEN);
  vi.stubEnv("FLEET_TICK_TOKEN", TICK_TOKEN);
  tick.advanceFleet.mockReset();
});

describe("promoting a release", () => {
  it("records a commit build as the fleet's target", async () => {
    const response = await release(RELEASE_TOKEN);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ image: IMAGE, paused: null });
    expect(fake.read("consoleFleet/release")).toMatchObject({ image: IMAGE, source: "ci", settingsGeneration: 0 });
  });

  it("refuses a missing token, a wrong one, and the tick's", async () => {
    for (const token of [undefined, "x".repeat(40), TICK_TOKEN]) expect((await release(token)).status).toBe(401);
    expect(fake.has("consoleFleet/release")).toBe(false);
  });

  it("opens for nobody when its token is unset or too short to be real", async () => {
    vi.stubEnv("FLEET_RELEASE_TOKEN", "");
    expect((await release("")).status).toBe(401);
    vi.stubEnv("FLEET_RELEASE_TOKEN", "short");
    expect((await release("short")).status).toBe(401);
  });

  it("refuses any image but a commit build of the bots' own repository", async () => {
    for (const image of [`ghcr.io/attacker/genaebot:${"a".repeat(40)}`, "ghcr.io/joe123-crypto/genaebot:main", 7]) {
      expect((await release(RELEASE_TOKEN, { image })).status).toBe(400);
    }
    expect((await release(RELEASE_TOKEN, "not an object")).status).toBe(400);
    expect(fake.has("consoleFleet/release")).toBe(false);
  });
});

describe("advancing the rollout", () => {
  it("answers 200 with what the tick did", async () => {
    tick.advanceFleet.mockResolvedValue({ target: IMAGE, paused: null, waiting: [], upToDate: 1, behind: 0 });
    const response = await advance(TICK_TOKEN);
    expect(response.status).toBe(200);
    expect((await response.json()).upToDate).toBe(1);
  });

  it("answers 409 on the tick that failed a bot, so that scheduled run fails and somebody hears", async () => {
    const paused = { at: "2026-11-27T09:00:00.000Z", reason: "wbotone1: its deployment ended CRASHED.", workspace: "wbotone1" };
    tick.advanceFleet.mockResolvedValue({ target: IMAGE, waiting: [], upToDate: 0, behind: 2, paused,
      failed: { workspace: "wbotone1", detail: paused.reason } });
    expect((await advance(TICK_TOKEN)).status).toBe(409);
  });

  it("answers 200 while it merely stays paused, because GitHub mails every failed run", async () => {
    tick.advanceFleet.mockResolvedValue({ target: IMAGE, waiting: [], upToDate: 0, behind: 2,
      paused: { at: "2026-11-27T09:00:00.000Z", reason: "wbotone1: its deployment ended CRASHED.", workspace: "wbotone1" } });
    const response = await advance(TICK_TOKEN);
    expect(response.status).toBe(200);
    expect((await response.json()).paused.workspace).toBe("wbotone1");
  });

  it("refuses the release token, and moves nothing", async () => {
    expect((await advance(RELEASE_TOKEN)).status).toBe(401);
    expect((await advance()).status).toBe(401);
    expect(tick.advanceFleet).not.toHaveBeenCalled();
  });
});
