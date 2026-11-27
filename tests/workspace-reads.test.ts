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

  const home = "workspaces/wk-alice1/campaigns/";

  it("accept any shape the bot names in a browser draft, and only the bot's prefix on the server", () => {
    const current = image(`${home}demo/${sha256}.jpg`);
    const legacy = image(`ads/demo/${sha256}.jpg`);
    const scoped = image(`w/wk-alice1/ads/demo/${sha256}.jpg`);
    for (const key of [current, legacy, scoped]) expect(uploadError(key, "demo")).toBeUndefined();
    expect(uploadError(current, "demo", home)).toBeUndefined();
    expect(uploadError(scoped, "demo", "w/wk-alice1/ads/")).toBeUndefined();
    expect(uploadError(legacy, "demo", home)).toBeTruthy();
    expect(uploadError(scoped, "demo", home)).toBeTruthy();
    expect(uploadError(current, "demo", "ads/")).toBeTruthy();
    expect(uploadError(image(`workspaces/wk-bobbb1/campaigns/demo/${sha256}.jpg`), "demo", home)).toBeTruthy();
  });

  it.each([`evil/ads/demo/${"b".repeat(64)}.jpg`, `w/../ads/demo/${"b".repeat(64)}.jpg`,
           `xads/demo/${"b".repeat(64)}.jpg`, `w/wk-alice1/ads/other/${"b".repeat(64)}.jpg`,
           `workspaces/../campaigns/demo/${"b".repeat(64)}.jpg`, `workspaces/wk-alice1/demo/${"b".repeat(64)}.jpg`,
           `workspaces/wk-alice1/campaigns/other-demo/${"b".repeat(64)}.jpg`,
           `workspaces/wk-alice1/campaigns/x/demo/${"b".repeat(64)}.jpg`])(
    "refuse %s", (key) => { expect(uploadError(image(key), "demo")).toBeTruthy(); });

  it("take the prefix a bot reports, and nothing from a bot that reports none or a misconfigured one", () => {
    expect(keyPrefixOf({ campaignCreation: { keyPrefix: home } })).toBe(home);
    expect(keyPrefixOf({ campaignCreation: { keyPrefix: "w/wk-alice1/ads/" } })).toBe("w/wk-alice1/ads/");
    expect(keyPrefixOf({ campaignCreation: {} })).toBeUndefined();
    expect(keyPrefixOf({ campaignCreation: { keyPrefix: null } })).toBeUndefined();
    for (const bad of ["pictures/", "workspaces/wk-alice1/", "workspaces/wk-alice1/campaigns", "workspaces/../campaigns/"]) {
      expect(keyPrefixOf({ campaignCreation: { keyPrefix: bad } })).toBeUndefined();
    }
  });
});

describe("creating on a workspace's bot", () => {
  const writes = (workspace: string | null | undefined, keyPrefix: string | null = "workspaces/wk-alice1/campaigns/"): WriteCapabilities => ({
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

  it("requires the picture location to be this workspace's own", () => {
    for (const own of ["workspaces/wk-alice1/campaigns/", "w/wk-alice1/ads/", "ads/"]) {
      expect(canCreateInWorkspace(true, writes("wk-alice1", own), "wk-alice1")).toEqual({ allowed: true });
    }
    for (const foreign of ["workspaces/wk-bobbb1/campaigns/", "w/wk-bobbb1/ads/"]) {
      expect(canCreateInWorkspace(true, writes("wk-alice1", foreign), "wk-alice1").allowed).toBe(false);
    }
  });
});
