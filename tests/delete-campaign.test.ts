import { afterEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ overview: vi.fn(), remove: vi.fn(), revalidate: vi.fn(), writable: true }));
vi.mock("@/src/config", async (original) => ({ ...await original<object>(), get WRITES_ENABLED() { return mocked.writable; }, OPERATOR_NAME: "Operator" }));
vi.mock("next/cache", () => ({ revalidatePath: mocked.revalidate }));
vi.mock("@/src/lib/bot-client", async (original) => ({ ...await original<object>(), getOverview: mocked.overview, deleteCampaign: mocked.remove }));
import { deleteCampaignAction } from "@/app/campaigns/actions";
import { BotUnavailableError, WriteRefusedError } from "@/src/lib/bot-client";
import { canDeleteCampaign } from "@/src/lib/write-capabilities";
const writes = { enabled: true, affectsProduction: true, fields: {}, delete: [], campaignDeletion: { delete: true } };
afterEach(() => { vi.clearAllMocks(); mocked.writable = true; });
describe("deleteCampaignAction", () => {
  it("checks fresh capability and revalidates every affected screen", async () => {
    mocked.overview.mockResolvedValue({ writes }); mocked.remove.mockResolvedValue({ slug: "cv", cleanup: "pending" });
    expect(await deleteCampaignAction("cv")).toEqual({ ok: true });
    expect(mocked.overview).toHaveBeenCalledWith(undefined, { fresh: true });
    expect(mocked.remove).toHaveBeenCalledWith("cv", { by: "Operator" });
    expect(mocked.revalidate.mock.calls.map(([path]) => path)).toEqual(expect.arrayContaining(["/", "/campaigns", "/campaigns/cv", "/groups", "/schedule"]));
  });
  it("refuses writes in read-only mode before making any bot call", async () => {
    mocked.writable = false;
    expect(await deleteCampaignAction("cv")).toMatchObject({ ok: false });
    expect(mocked.overview).not.toHaveBeenCalled(); expect(mocked.remove).not.toHaveBeenCalled();
  });
  it.each(["../cv", "CV", "", "new", "a".repeat(65)])("refuses invalid slug %s", async (slug) => {
    expect(await deleteCampaignAction(slug)).toMatchObject({ ok: false }); expect(mocked.overview).not.toHaveBeenCalled();
  });
  it("refuses an older bot even if it advertises a generic campaign delete", async () => {
    mocked.overview.mockResolvedValue({ writes: { ...writes, delete: ["campaigns"], campaignDeletion: undefined } });
    expect(await deleteCampaignAction("cv")).toMatchObject({ ok: false }); expect(mocked.remove).not.toHaveBeenCalled();
  });
  it.each([new BotUnavailableError("Timeout; change may have been made"), new WriteRefusedError("refused", ["reason"], 409)])("retains the backend error", async (error) => {
    mocked.overview.mockResolvedValue({ writes }); mocked.remove.mockRejectedValueOnce(error);
    expect(await deleteCampaignAction("cv")).toMatchObject({ ok: false, detail: error.detail });
    expect(mocked.revalidate).not.toHaveBeenCalled();
  });
});
describe("canDeleteCampaign", () => {
  it("requires explicit live deletion support", () => {
    expect(canDeleteCampaign(true, writes)).toEqual({ allowed: true });
    expect(canDeleteCampaign(false, writes).allowed).toBe(false);
    expect(canDeleteCampaign(true, { ...writes, affectsProduction: false }).allowed).toBe(false);
    expect(canDeleteCampaign(true, undefined).allowed).toBe(false);
    expect(canDeleteCampaign(true, { ...writes, campaignDeletion: { delete: false, reason: "Missing R2 credentials" } })).toEqual({ allowed: false, reason: "Missing R2 credentials" });
  });
});
