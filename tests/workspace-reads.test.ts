import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Two users reading the same screen at the same moment ask two different bots.
 * The in-flight read sharing keys on the address and token, so it must never
 * hand one workspace's answer to another. And a picture key names its
 * workspace, so neither the browser nor the server may sign one elsewhere.
 */
vi.mock("@/src/config", async (original) => ({
  ...await original<typeof import("@/src/config")>(),
  BOT_SOURCE: "remote", WRITE_SOURCE: "remote", WRITES_ENABLED: true,
}));

import { botTarget } from "@/src/lib/workspace";
import { getOverview } from "@/src/lib/bot-client";
import { getLiveView } from "@/src/lib/live-client";
import { keyPrefixOf, uploadError } from "@/src/domains/campaign-create";
import { canCreateInWorkspace } from "@/src/lib/write-capabilities";
import type { WriteCapabilities } from "@/src/lib/types";

const ALICE = { baseUrl: "https://alice-bot.example", token: "alice-token", workspaceId: "wk-alice1" };
const BOB = { baseUrl: "https://bob-bot.example", token: "bob-token", workspaceId: "wk-bobbb1" };
afterEach(() => { vi.unstubAllGlobals(); });

describe("concurrent reads for two workspaces", () => {
  it("never share a request, an address or a token", async () => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    const fetch = vi.fn(async (url: string, _init?: RequestInit) => { await ready; return Response.json({ campaigns: [], from: url }); });
    vi.stubGlobal("fetch", fetch);
    vi.mocked(botTarget).mockResolvedValueOnce(ALICE).mockResolvedValueOnce(BOB);
    const reads = Promise.all([getOverview(), getOverview()]);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    release();
    const [alice, bob] = await reads as unknown as Array<{ from: string }>;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(alice.from).toBe("https://alice-bot.example/internal/console/overview?");
    expect(bob.from).toBe("https://bob-bot.example/internal/console/overview?");
    expect(fetch.mock.calls.map(([, init]) => (init?.headers as Record<string, string>).authorization))
      .toEqual(["Bearer alice-token", "Bearer bob-token"]);
  });

  it("applies to live views too", async () => {
    const fetch = vi.fn(async (url: string) => Response.json({ from: url }));
    vi.stubGlobal("fetch", fetch);
    vi.mocked(botTarget).mockResolvedValueOnce(ALICE).mockResolvedValueOnce(BOB);
    const [alice, bob] = await Promise.all([getLiveView<{ from: string }>("groups"), getLiveView<{ from: string }>("groups")]);
    expect(alice.from).toContain("alice-bot.example");
    expect(bob.from).toContain("bob-bot.example");
  });
});

describe("picture keys", () => {
  const sha256 = "b".repeat(64);
  const image = (key: string) => ({ filename: "a.jpg", contentType: "image/jpeg", bytes: 10, sha256, key });

  it("accept either shape in a browser draft, and only the bot's prefix on the server", () => {
    const legacy = image(`ads/demo/${sha256}.jpg`);
    const scoped = image(`w/wk-alice1/ads/demo/${sha256}.jpg`);
    expect(uploadError(legacy, "demo")).toBeUndefined();
    expect(uploadError(scoped, "demo")).toBeUndefined();
    expect(uploadError(scoped, "demo", "w/wk-alice1/ads/")).toBeUndefined();
    expect(uploadError(scoped, "demo", "ads/")).toBeTruthy();
    expect(uploadError(legacy, "demo", "w/wk-alice1/ads/")).toBeTruthy();
    expect(uploadError(image(`w/wk-bobbb1/ads/demo/${sha256}.jpg`), "demo", "w/wk-alice1/ads/")).toBeTruthy();
  });

  it.each([`evil/ads/demo/${"b".repeat(64)}.jpg`, `w/../ads/demo/${"b".repeat(64)}.jpg`,
           `xads/demo/${"b".repeat(64)}.jpg`, `w/wk-alice1/ads/other/${"b".repeat(64)}.jpg`])(
    "refuse %s", (key) => { expect(uploadError(image(key), "demo")).toBeTruthy(); });

  it("take the prefix a bot reports, ads/ from an older bot, and nothing from a misconfigured one", () => {
    expect(keyPrefixOf({ campaignCreation: { keyPrefix: "w/wk-alice1/ads/" } })).toBe("w/wk-alice1/ads/");
    expect(keyPrefixOf({ campaignCreation: {} })).toBe("ads/");
    expect(keyPrefixOf({ campaignCreation: { keyPrefix: null } })).toBeUndefined();
    expect(keyPrefixOf({ campaignCreation: { keyPrefix: "pictures/" } })).toBeUndefined();
  });
});

describe("creating on a workspace's bot", () => {
  const writes = (workspace: string | null | undefined, keyPrefix: string | null = "ads/"): WriteCapabilities => ({
    enabled: true, affectsProduction: true, fields: {}, delete: [], workspace,
    campaignCreation: { create: true, images: true, scheduling: true, keyPrefix },
  });

  it("requires the bot to serve this very workspace", () => {
    expect(canCreateInWorkspace(true, writes("wk-alice1"), "wk-alice1")).toEqual({ allowed: true });
    for (const reported of ["wk-bobbb1", null, undefined]) {
      const gate = canCreateInWorkspace(true, writes(reported), "wk-alice1");
      expect(gate.allowed).toBe(false);
      expect(gate.allowed || gate.reason).toContain("GENAIE_WORKSPACE_ID");
    }
  });

  it("requires a usable picture location", () => {
    expect(canCreateInWorkspace(true, writes("wk-alice1", null), "wk-alice1").allowed).toBe(false);
  });
});
