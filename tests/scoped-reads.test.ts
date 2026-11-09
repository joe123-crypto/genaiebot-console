import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/config", () => ({
  BOT_SOURCE: "remote", BOT_API_BASE_URL: "https://bot.example", BOT_API_TOKEN: "read",
  GENAEBOT_CHECKOUT: "/unused", WRITE_SOURCE: "remote", WRITES_ENABLED: true,
  BOT_WRITE_API_BASE_URL: "https://bot.example", BOT_WRITE_TOKEN: "write",
}));
import { getCampaignPayload, getCampaignPreview, getCampaignState, getCapabilities, getConfiguration,
  getGroups, getNavigation, updateGroupBatch } from "@/src/lib/bot-client";

afterEach(() => vi.unstubAllGlobals());

describe("operation-specific bot reads", () => {
  it("loads one campaign, its groups and capabilities without the overview or campaign list", async () => {
    const fetch = vi.fn(async (url: string) => Response.json(url.includes("/campaign/") || url.includes("/campaign-state/")
      ? { date: "today", campaign: { slug: "demo", enabled: true } }
      : url.includes("/capabilities") ? { writes: { enabled: true } }
      : { date: "today", groups: [], disabledPromos: [] }));
    vi.stubGlobal("fetch", fetch);
    await getCampaignPayload("demo");
    await getGroups(undefined, { campaign: "demo" });
    await getCapabilities();
    await getCampaignState("demo", { fresh: true });
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/internal/console/campaign/demo", "/internal/console/campaign-groups/demo", "/internal/console/capabilities", "/internal/console/campaign-state/demo",
    ]);
  });

  it("uses bounded ID lookups and fresh checks instead of the entire directory", async () => {
    const fetch = vi.fn(async (_url: string) => Response.json({ groups: [], disabledPromos: [] }));
    vi.stubGlobal("fetch", fetch);
    await getGroups(undefined, { fresh: true, jids: ["123@g.us", "456@g.us"] });
    expect(new URL(fetch.mock.calls[0][0] as string).pathname).toBe("/internal/console/groups-by-id/123%40g.us%2C456%40g.us");
    expect(new URL(fetch.mock.calls[0][0] as string).searchParams.get("fresh")).toBe("1");
    await getGroups(undefined, { jids: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("settings, navigation and caption saves use their narrow routes", async () => {
    const fetch = vi.fn(async (_url: string) => Response.json({ enabled: true, captions: ["text"], groups: [] }));
    vi.stubGlobal("fetch", fetch);
    await getConfiguration({ fresh: true });
    await getNavigation();
    await getCampaignPreview("demo", undefined, { fresh: true, captionsOnly: true });
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/internal/console/settings", "/internal/console/navigation", "/internal/console/captions/demo",
    ]);
  });

  it("falls back only when an old bot explicitly lacks a scoped route", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: "not found" }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ campaigns: [{ slug: "demo", enabled: true }], date: "today" }));
    vi.stubGlobal("fetch", fetch);
    expect((await getCampaignPayload("demo")).campaign?.slug).toBe("demo");
    expect(fetch.mock.calls[1][0]).toContain("/campaigns?");
    fetch.mockReset().mockResolvedValue(Response.json({ error: "quota" }, { status: 429 }));
    await expect(getCampaignPayload("demo")).rejects.toMatchObject({ status: 429 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("submits a batch once, with no mutation replay on an uncertain failure", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: "outcome unknown" }, { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const changes = [{ id: "123@g.us", fields: { promos: ["demo"] }, expected: { promos: [] } }];
    await expect(updateGroupBatch(changes, { by: "Operator" })).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain("/config/batch/groups");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ changes, actor: "Operator" });
  });

  it("does not reuse a pre-save read for the post-save refresh", async () => {
    let release!: (response: Response) => void;
    let groups = 0;
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("/config/batch/groups")) return Response.json({ done: [], changed: 0 });
      if (++groups === 1) return new Promise<Response>((resolve) => { release = resolve; });
      return Response.json({ groups: [{ jid: "new@g.us" }], disabledPromos: [] });
    });
    vi.stubGlobal("fetch", fetch);
    const before = getGroups();
    await updateGroupBatch([{ id: "123@g.us", fields: { note: "change" } }], { by: "Operator" });
    const after = await getGroups();
    expect(after.groups[0].jid).toBe("new@g.us");
    release(Response.json({ groups: [{ jid: "old@g.us" }], disabledPromos: [] }));
    expect((await before).groups[0].jid).toBe("old@g.us");
    expect(groups).toBe(2);
  });

  it("reports unsupported batches separately from uncertain write failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "not found" }, { status: 404 })));
    await expect(updateGroupBatch([{ id: "123@g.us", fields: {} }], { by: "Operator" })).resolves.toBeNull();
  });
});
