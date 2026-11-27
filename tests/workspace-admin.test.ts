import { describe, expect, it, vi } from "vitest";
import { botOrigin, checkBot, deriveBotToken as scriptToken } from "@/scripts/workspace-admin.mjs";
import { deriveBotToken } from "@/src/lib/workspace";

/**
 * The admin script derives the token a bot is given; the console derives the
 * token it sends. They are two implementations of one rule, so they are pinned
 * to each other, and `connect-bot` must refuse any bot that is not the one the
 * workspace names.
 */
const SECRET = "x".repeat(48);

describe("workspace-admin", () => {
  it("derives exactly the token the console sends", () => {
    for (const id of ["wk-alice1", "wAbCdEfGhIjKlMnOp", "w_-123456"]) {
      expect(scriptToken(id, SECRET)).toBe(deriveBotToken(id, SECRET));
    }
  });

  it("accepts only a bare https origin (or loopback http)", () => {
    expect(botOrigin("https://gateway.example/")).toBe("https://gateway.example");
    expect(botOrigin("http://127.0.0.1:18790")).toBe("http://127.0.0.1:18790");
    for (const bad of ["http://gateway.example", "https://gateway.example/internal", "https://a:b@gateway.example"]) {
      expect(() => botOrigin(bad)).toThrow();
    }
  });

  it("connects a bot only when it accepts the workspace's token and serves that workspace", async () => {
    const answer = (status: number, body: unknown) =>
      vi.fn(async (_url: string, _init: { headers: Record<string, string> }) => Response.json(body, { status }));
    const serving = answer(200, { writes: { workspace: "wk-alice1", campaignCreation: { keyPrefix: "workspaces/wk-alice1/campaigns/" } } });
    await expect(checkBot("https://bot.example", "wk-alice1", { fetchImpl: serving, secret: SECRET }))
      .resolves.toMatchObject({ workspace: "wk-alice1" });
    expect(serving.mock.calls[0][1].headers.authorization).toBe(`Bearer ${deriveBotToken("wk-alice1", SECRET)}`);

    await expect(checkBot("https://bot.example", "wk-alice1",
      { fetchImpl: answer(200, { writes: { workspace: "wk-bobbb1" } }), secret: SECRET })).rejects.toThrow(/serves workspace wk-bobbb1/);
    await expect(checkBot("https://bot.example", "wk-alice1",
      { fetchImpl: answer(200, { writes: { workspace: null } }), secret: SECRET })).rejects.toThrow(/serves no workspace/);
    await expect(checkBot("https://bot.example", "wk-alice1",
      { fetchImpl: answer(401, { error: "unauthorized" }), secret: SECRET })).rejects.toThrow(/refused this workspace's token/);
  });
});

describe("workspace-admin link", () => {
  it("treats a users document as its own stray pointer only when that is all it holds", async () => {
    const { isStrayPointer } = await import("@/scripts/workspace-admin.mjs");
    expect(isStrayPointer({ email: "a@example.com", workspaceId: "wk-alice1", createdAt: {} }, "wk-alice1")).toBe(true);
    expect(isStrayPointer({ email: "a@example.com", workspaceId: "wk-alice1", createdAt: {}, plan: "pro" }, "wk-alice1")).toBe(false);
    expect(isStrayPointer({ email: "a@example.com", workspaceId: "wk-bobbb1", createdAt: {} }, "wk-alice1")).toBe(false);
    expect(isStrayPointer(undefined, "wk-alice1")).toBe(false);
  });
});

describe("workspace-admin sweep-bots", () => {
  const services = [
    { id: "svc-template", name: "gateway" },
    { id: "svc-live", name: "bot-wLiveWorkspace1" },
    { id: "svc-gone", name: "bot-wGoneWorkspace1" },
    { id: "svc-hand", name: "my-bot" },
  ];
  const volumes = [
    { volumeId: "vol-template", name: "gateway-volume", serviceId: "svc-template", pendingDeletion: false },
    { volumeId: "vol-live", name: "bot-wliveworkspace1-volume", serviceId: "svc-live", pendingDeletion: false },
    { volumeId: "vol-gone", name: "bot-wgoneworkspace1-volume", serviceId: "svc-gone", pendingDeletion: false },
    { volumeId: "vol-old", name: "bot-wgoneworkspace1-volume", serviceId: "svc-gone", pendingDeletion: true },
    { volumeId: "vol-loose", name: "bot-wlooseworkspace-volume", serviceId: null, pendingDeletion: false },
    { volumeId: "vol-probe", name: "probe-volume", serviceId: null, pendingDeletion: false },
  ];

  it("lists only console-built bots whose workspace is gone, with the volumes still mounted on them", async () => {
    const { sweepPlan } = await import("@/scripts/workspace-admin.mjs");
    const plan = sweepPlan({ services, volumes, existing: new Set(["wLiveWorkspace1"]), templateServiceId: "svc-template" });
    expect(plan.orphans).toEqual([{ workspaceId: "wGoneWorkspace1", service: services[2], volumes: ["vol-gone"] }]);
    // Mounted on nothing, so nothing says whose it is: reported, never deleted.
    expect(plan.detached.map((volume: { volumeId: string }) => volume.volumeId)).toEqual(["vol-loose"]);
  });

  it("never offers the template, even under a bot's name, nor a bot whose workspace exists", async () => {
    const { sweepPlan } = await import("@/scripts/workspace-admin.mjs");
    const named = [{ id: "svc-template", name: "bot-wTemplateSpace1" }, ...services.slice(1, 2)];
    const plan = sweepPlan({ services: named, volumes, existing: new Set(["wLiveWorkspace1"]), templateServiceId: "svc-template" });
    expect(plan.orphans).toEqual([]);
  });
});
