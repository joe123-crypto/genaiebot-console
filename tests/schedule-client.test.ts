import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/src/config", () => ({ BOT_SOURCE: "remote", BOT_API_BASE_URL: "https://bot.example", BOT_API_TOKEN: "read-token", GENAEBOT_CHECKOUT: "/unused", WRITE_SOURCE: "remote", WRITES_ENABLED: true, BOT_WRITE_API_BASE_URL: "https://bot.example", BOT_WRITE_TOKEN: "write-token" }));
import { saveSchedule, WriteRefusedError } from "@/src/lib/bot-client";
const input = { date: "2026-11-10", timezone: "Africa/Harare", changes: [{ slug: "borehole-drilling", time: "07:10", expectedRevision: "a".repeat(64) }] };
const saved = { slug: "borehole-drilling", minutes: 430, scheduleEdit: { revision: "b".repeat(64), editable: true, status: "pending", confirmedMinutes: 435 } };
afterEach(() => vi.unstubAllGlobals());
it("posts to the authenticated schedule endpoint with no caching", async () => {
  const fetch = vi.fn(async () => Response.json({ campaigns: [saved] })); vi.stubGlobal("fetch", fetch);
  expect(await saveSchedule(input, { by: "Operator" })).toEqual({ campaigns: [saved] });
  expect(fetch).toHaveBeenCalledWith("https://bot.example/internal/console/schedule", expect.objectContaining({ method: "POST", cache: "no-store", headers: expect.objectContaining({ authorization: "Bearer write-token" }), body: JSON.stringify({ ...input, actor: "Operator" }) }));
});
it("keeps bot validation refusals", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, status: 409, error: "stale", problems: [] }, { status: 409 })));
  await expect(saveSchedule(input, { by: "Operator" })).rejects.toBeInstanceOf(WriteRefusedError);
});
it("does not report malformed, partial or mismatched successes as confirmed", async () => {
  for (const value of [null, {}, { campaigns: [] }, { campaigns: [saved, saved] }, { campaigns: [{ ...saved, slug: "other" }] }, { campaigns: [{ ...saved, minutes: -1 }] }, { campaigns: [{ ...saved, minutes: 440 }] }, { campaigns: [{ ...saved, scheduleEdit: {} }] }]) {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(value)));
    await expect(saveSchedule(input, { by: "Operator" })).rejects.toMatchObject({ detail: expect.stringContaining("may have been saved") });
  }
  vi.stubGlobal("fetch", vi.fn(async () => new Response("not json")));
  await expect(saveSchedule(input, { by: "Operator" })).rejects.toMatchObject({ detail: expect.stringContaining("may have been saved") });
});
