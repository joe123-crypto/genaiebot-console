import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/src/config", async original => ({ ...await original<object>(), BOT_API_BASE_URL: "https://bot.example", BOT_API_TOKEN: "read" }));
import { getLiveView } from "@/src/lib/live-client";
afterEach(() => vi.unstubAllGlobals());
it("never falls back to full-directory endpoints or retries a missing live endpoint", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ error: "not found" }, { status: 404 })); vi.stubGlobal("fetch", fetch);
  await expect(getLiveView("groups")).rejects.toMatchObject({ status: 404 });
  expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][0]).toContain("/live/groups?");
});
