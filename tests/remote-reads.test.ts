import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/config", () => ({
  BOT_SOURCE: "remote", BOT_API_BASE_URL: "https://bot.example", BOT_API_TOKEN: "read-token",
  GENAEBOT_CHECKOUT: "/unused", WRITE_SOURCE: "remote", WRITES_ENABLED: true,
  BOT_WRITE_API_BASE_URL: "https://bot.example", BOT_WRITE_TOKEN: "read-token",
}));
import { BotUnavailableError, getCampaignPreview, getCampaigns, getGroups, getOverview, updateCampaign } from "@/src/lib/bot-client";

const payload = (url: string) => url.includes("/preview/")
  ? { enabled: true, captions: [], groups: [], tracking: {} }
  : url.includes("/groups") ? { disabledPromos: [], groups: [] } : { campaigns: [] };
const busy = (retryAfter?: string) => new Response('{"error":"busy"}', {
  status: 503, headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter },
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("remote reads", () => {
  it("completes a cold campaign page's four reads with at most two requests active", async () => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    let active = 0;
    let peak = 0;
    const fetch = vi.fn(async (url: string) => {
      active++;
      peak = Math.max(active, peak);
      await ready;
      active--;
      return Response.json(payload(url));
    });
    vi.stubGlobal("fetch", fetch);
    const reads = Promise.all([getCampaigns(), getGroups(), getCampaignPreview("borehole"), getOverview()]);
    expect(fetch).toHaveBeenCalledTimes(2);
    release();
    await reads;
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(peak).toBe(2);
  });

  it("deduplicates matching in-flight reads but does not cache completed values", async () => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    const fetch = vi.fn(async () => { await ready; return Response.json(payload("/preview/borehole")); });
    vi.stubGlobal("fetch", fetch);
    const first = getCampaignPreview("borehole");
    const second = getCampaignPreview("borehole");
    expect(fetch).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toEqual(await second);
    await getCampaignPreview("borehole");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("honours Retry-After and recovers from a temporary 503", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(busy("1")).mockResolvedValue(Response.json({ campaigns: [] }));
    vi.stubGlobal("fetch", fetch);
    const read = getCampaigns();
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(read).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["99999", new Date(Date.now() + 86_400_000).toUTCString()])(
    "bounds excessive Retry-After values: %s", async (retryAfter) => {
      vi.useFakeTimers();
      const fetch = vi.fn().mockResolvedValueOnce(busy(retryAfter)).mockResolvedValue(Response.json({ campaigns: [] }));
      vi.stubGlobal("fetch", fetch);
      const read = getCampaigns();
      await vi.advanceTimersByTimeAsync(4999);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(read).resolves.toEqual([]);
    },
  );

  it("stops after two retries, keeps the status and safe reason, then allows another read", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(busy()));
    vi.stubGlobal("fetch", fetch);
    const failed = getCampaigns().catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await failed).toMatchObject({ status: 503, detail: "campaigns returned 503: busy" });
    expect(fetch).toHaveBeenCalledTimes(3);
    fetch.mockResolvedValue(Response.json({ campaigns: [] }));
    await expect(getCampaigns()).resolves.toEqual([]);
  });

  it.each([401, 404, 500, 502, 504])("does not retry HTTP %s or display proxy HTML", async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response("<html>private upstream failure</html>", { status }));
    vi.stubGlobal("fetch", fetch);
    await expect(getCampaigns()).rejects.toMatchObject({ status, detail: `campaigns returned ${status}` });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("normalizes invalid JSON and network failures, releasing the read slot", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("broken"))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(Response.json({ campaigns: [] }));
    vi.stubGlobal("fetch", fetch);
    await expect(getCampaigns()).rejects.toMatchObject({ detail: "campaigns returned invalid JSON", status: 200 });
    await expect(getCampaigns()).rejects.toBeInstanceOf(BotUnavailableError);
    await expect(getCampaigns()).resolves.toEqual([]);
    expect(fetch.mock.calls[0][1].signal).toBeDefined();
  });

  it("never retries a config write returning 503", async () => {
    const fetch = vi.fn().mockResolvedValue(busy());
    vi.stubGlobal("fetch", fetch);
    await expect(updateCampaign("borehole", { enabled: false }, { by: "Joseph" })).rejects.toBeInstanceOf(BotUnavailableError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].method).toBe("POST");
  });
});
