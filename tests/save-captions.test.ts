import { TEST_ACTOR } from "./auth-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";

const update = vi.fn();
const preview = vi.fn();
const updateFields = vi.fn();
const capabilities = vi.fn();
const revalidate = vi.fn();
async function load(writes = true) {
  vi.resetModules(); update.mockReset(); updateFields.mockReset(); capabilities.mockReset(); preview.mockReset(); revalidate.mockReset();
  capabilities.mockResolvedValue({ enabled: true, affectsProduction: true, fields: { campaigns: ["captions", "tracking"] }, delete: [] });
  preview.mockResolvedValue({ captions: ["Original"] });
  vi.doMock("@/src/config", () => ({ WRITES_ENABLED: writes }));
  vi.doMock("next/cache", () => ({ revalidatePath: revalidate }));
  vi.doMock("@/src/lib/bot-client", () => ({
    updateCampaignCaptions: update, getCampaignPreview: preview, updateCampaign: updateFields, getCapabilities: capabilities,
    BotUnavailableError: class extends Error { detail = "write unavailable"; },
    WritesDisabledError: class extends Error { detail = "writes off"; },
  }));
  return (await import("@/app/campaigns/actions")).saveCaptionsAction;
}
afterEach(() => {
  vi.resetModules();
  for (const name of ["@/src/config", "next/cache", "@/src/lib/bot-client"]) vi.doUnmock(name);
});
describe("saveCaptionsAction", () => {
  it("guards the endpoint while writes are off", async () => {
    const save = await load(false);
    expect(await save("borehole", ["Edited"], ["Original"])).toEqual({ ok: false, detail: "The console is in read-only mode." });
    expect(update).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled();
  });
  it.each([[], [""], [" \n"], ["valid", null], "text"].map((value) => [value]))("refuses invalid captions %j", async (captions) => {
    const save = await load();
    expect((await save("borehole", captions as string[], ["Original"])).ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
  it("validates campaign names and request size", async () => {
    const save = await load();
    expect((await save("../nope", ["Edited"], ["Original"])).ok).toBe(false);
    expect((await save("borehole", ["💧".repeat(20_000)], ["Original"])).ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
  it("refuses a stale draft rather than overwriting newer captions", async () => {
    const save = await load();
    preview.mockResolvedValue({ captions: ["Changed elsewhere"] });
    expect(await save("borehole", ["Edited"], ["Original"])).toMatchObject({ ok: false, latestCaptions: ["Changed elsewhere"] });
    expect(update).not.toHaveBeenCalled();
  });
  it("validates the original snapshot before comparing or writing", async () => {
    const save = await load();
    expect((await save("borehole", ["Edited"], null as unknown as string[])).ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
  });
  it("attributes the write, preserves templates, and refreshes affected screens", async () => {
    const save = await load();
    const captions = ["💧 New\n\n{ref_link} {bot_number}", "Second"];
    expect(await save("borehole", captions, ["Original"])).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith("borehole", captions, { by: TEST_ACTOR });
    expect(revalidate.mock.calls).toEqual([["/campaigns/borehole"], ["/campaigns"], ["/"]]);
  });
  it("returns write errors so the operator keeps the draft", async () => {
    const save = await load();
    const { BotUnavailableError } = await import("@/src/lib/bot-client");
    update.mockRejectedValue(new BotUnavailableError("unavailable"));
    expect(await save("borehole", ["Edited"], ["Original"])).toEqual({ ok: false, detail: "write unavailable" });
    expect(revalidate).not.toHaveBeenCalled();
  });
});


it("writes captions and tracking together after checking the tracking baseline", async () => {
  const save = await load();
  const tracking = { prefix: "sale", number: "+26370000001" };
  preview.mockResolvedValue({ captions: ["Original"], tracking: {} });
  expect(await save("sale", ["Original {ref_link}"], ["Original"], { tracking, expectedTracking: {} })).toEqual({ ok: true });
  expect(updateFields).toHaveBeenCalledWith("sale", { captions: ["Original {ref_link}"], tracking }, { by: TEST_ACTOR });
  expect(update).not.toHaveBeenCalled();
});

it("rejects concurrent tracking changes, invalid settings and unsupported bots without writing", async () => {
  const save = await load();
  const tracking = { prefix: "sale", number: "+26370000001" };
  preview.mockResolvedValue({ captions: ["Original"], tracking });
  expect(await save("sale", ["Edited"], ["Original"], { tracking, expectedTracking: {} })).toMatchObject({ ok: false, latestTracking: tracking });
  expect(await save("sale", ["Edited"], ["Original"], { tracking: { ...tracking, number: "123" }, expectedTracking: {} })).toMatchObject({ ok: false, detail: expect.stringContaining("international") });
  capabilities.mockResolvedValue({ enabled: true, affectsProduction: true, fields: { campaigns: ["captions"] }, delete: [] });
  expect(await save("sale", ["Edited"], ["Original"], { tracking, expectedTracking: tracking })).toMatchObject({ ok: false, detail: expect.stringContaining("does not accept") });
  expect(updateFields).not.toHaveBeenCalled();
});
