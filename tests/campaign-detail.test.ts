import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ campaigns: vi.fn(), preview: vi.fn(), groups: vi.fn(), overview: vi.fn(), notFound: vi.fn() }));
vi.mock("@/src/lib/bot-client", () => ({
  BotUnavailableError: class extends Error { constructor(public detail: string, public status?: number) { super(detail); } },
  getCampaignPayload: mocks.campaigns, getCapabilities: mocks.overview, getCampaignPreview: mocks.preview, getGroups: mocks.groups,
  captionSaveUnavailableReason: () => undefined, imageWritesUnavailableReason: () => "Unavailable",
}));
vi.mock("@/src/domains/console", () => ({ loadOverview: mocks.overview }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/app/_components/shell-wrapper", () => ({ Shell: () => null }));
vi.mock("@/app/campaigns/_components/campaign-detail-view", () => ({ CampaignDetailView: () => null }));
import { BotUnavailableError } from "@/src/lib/bot-client";
import { loadCampaignDetail } from "@/src/domains/campaign-detail";
import CampaignPage from "@/app/campaigns/[slug]/page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.campaigns.mockResolvedValue({
    date: "2026-11-09", adAssets: { mode: "r2", source: "firestore", fetchedAt: "x", note: null },
    campaign: { slug: "borehole", enabled: true },
  });
  mocks.preview.mockResolvedValue({ groups: [], captions: [] });
  mocks.groups.mockResolvedValue({ groups: [] });
  mocks.overview.mockResolvedValue({ enabled: true });
  mocks.notFound.mockImplementation(() => { throw new Error("404"); });
});

describe("campaign resource loading", () => {
  it.each(["campaigns", "preview", "groups"] as const)("isolates a failed %s read", async (read) => {
    mocks[read].mockRejectedValue(new BotUnavailableError("busy", 503));
    const result = await loadCampaignDetail("borehole");
    const key = { campaigns: "campaign", preview: "preview", groups: "membership" }[read] as "campaign" | "preview" | "membership";
    expect(result[key]).toEqual({ ok: false, error: { detail: "busy", status: 503 } });
    const reads = [result.campaign, result.preview, result.membership, result.writes];
    expect(reads.filter((value) => value.ok)).toHaveLength(3);
  });

  it("keeps readable campaign data when capabilities cannot load", async () => {
    mocks.overview.mockRejectedValue(new BotUnavailableError("overview unavailable"));
    const result = await loadCampaignDetail("borehole");
    expect(result.writes).toEqual({ ok: false, error: { detail: "overview unavailable" } });
    expect(result.campaign).toMatchObject({ ok: true, receivedAt: expect.any(String) });
    expect(result.preview.ok).toBe(true);
    expect(result.membership.ok).toBe(true);
  });

  it("does not convert a failed campaign list into a 404", async () => {
    mocks.campaigns.mockRejectedValue(new BotUnavailableError("unavailable"));
    await CampaignPage({ params: Promise.resolve({ slug: "borehole" }) });
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("returns 404 only when a successful list confirms the campaign is absent", async () => {
    mocks.campaigns.mockResolvedValue({ date: "2026-11-09", campaign: null });
    await expect(CampaignPage({ params: Promise.resolve({ slug: "borehole" }) })).rejects.toThrow("404");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("takes where the pictures are from the campaign read, not a second one", async () => {
    const result = await loadCampaignDetail("borehole");
    expect(result.adAssets).toEqual({ mode: "r2", source: "firestore", fetchedAt: "x", note: null });
    expect(mocks.campaigns).toHaveBeenCalledOnce();
  });

  it("reports no picture source rather than a stale one when the read fails", async () => {
    mocks.campaigns.mockRejectedValue(new BotUnavailableError("busy", 503));
    expect((await loadCampaignDetail("borehole")).adAssets).toBeNull();
  });

  it("survives a bot too old to say where its pictures are", async () => {
    mocks.campaigns.mockResolvedValue({ date: "2026-11-09", campaign: { slug: "borehole" } });
    const result = await loadCampaignDetail("borehole");
    expect(result.adAssets).toBeNull();
    expect(result.campaign.ok).toBe(true);
  });

  it("does not swallow programming errors", async () => {
    mocks.preview.mockRejectedValue(new TypeError("bug"));
    await expect(loadCampaignDetail("borehole")).rejects.toThrow("bug");
  });
});
