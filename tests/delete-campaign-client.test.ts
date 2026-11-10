import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/src/config", () => ({
  BOT_SOURCE: "remote", BOT_API_BASE_URL: "https://bot.example", BOT_API_TOKEN: "read-token", GENAEBOT_CHECKOUT: "/unused",
  WRITE_SOURCE: "remote", WRITES_ENABLED: true, BOT_WRITE_API_BASE_URL: "https://bot.example", BOT_WRITE_TOKEN: "write-token",
}));
import { deleteCampaign, WriteRefusedError } from "@/src/lib/bot-client";
afterEach(() => vi.unstubAllGlobals());
it("posts the actor to the authenticated deletion endpoint without caching", async () => {
  const fetch = vi.fn(async () => Response.json({ slug: "cv", cleanup: "pending" })); vi.stubGlobal("fetch", fetch);
  expect(await deleteCampaign("cv", { by: "Operator" })).toEqual({ slug: "cv", cleanup: "pending" });
  expect(fetch).toHaveBeenCalledWith("https://bot.example/internal/console/campaigns/cv/delete", expect.objectContaining({ method: "POST", cache: "no-store", headers: expect.objectContaining({ authorization: "Bearer write-token" }), body: JSON.stringify({ actor: "Operator" }) }));
});
it("preserves refusal details", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: "refused", problems: ["missing cleanup credentials"], status: 409 }, { status: 409 })));
  await expect(deleteCampaign("cv", { by: "Operator" })).rejects.toBeInstanceOf(WriteRefusedError);
});
it("reports a timeout as an unknown outcome", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); }));
  await expect(deleteCampaign("cv", { by: "Operator" })).rejects.toMatchObject({ detail: expect.stringContaining("change may still have been made") });
});
it("does not treat an invalid success response as a confirmed deletion", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ slug: "other", cleanup: "complete" })));
  await expect(deleteCampaign("cv", { by: "Operator" })).rejects.toMatchObject({ detail: expect.stringContaining("may have been deleted") });
});
it("keeps malformed acknowledgements as unknown outcomes instead of crashing the action", async () => {
  for (const response of [Response.json(null), new Response("not json", { status: 200 })]) {
    vi.stubGlobal("fetch", vi.fn(async () => response));
    await expect(deleteCampaign("cv", { by: "Operator" })).rejects.toMatchObject({ detail: expect.stringContaining("may have been deleted") });
  }
});
