import { afterEach, expect, it, vi } from "vitest";
import { loadCampaignGroupChoices } from "@/app/campaigns/_components/group-choices";
afterEach(() => vi.unstubAllGlobals());
it("looks up draft additions in batches of ten using read-only live requests", async () => {
  const ids = Array.from({ length: 12 }, (_, i) => `${i + 1}@g.us`);
  const fetch = vi.fn(async (url: string) => {
    const jids = new URL(url, "http://localhost").searchParams.get("ids")!.split(",");
    expect(jids.length).toBeLessThanOrEqual(10);
    return Response.json({ rows: jids.map(jid => ({ jid, name: jid, account: "default", status: "active" })) });
  });
  vi.stubGlobal("fetch", fetch);
  expect((await loadCampaignGroupChoices(ids)).map(row => row.jid)).toEqual(ids);
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [url, options] of fetch.mock.calls as unknown as [string, RequestInit][]) {
    expect(url).toMatch(/^\/api\/live\/groups\?/);
    expect(options.method).toBeUndefined();
  }
});
it("keeps an unavailable read as a failure rather than an empty directory", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Waiting for committed changes." }, { status: 503 })));
  await expect(loadCampaignGroupChoices(["1@g.us"])).rejects.toThrow("Waiting for committed changes.");
});
