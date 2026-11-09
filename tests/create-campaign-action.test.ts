import { beforeEach, describe, expect, it, vi } from "vitest";
import { validCampaign } from "./fixtures/new-campaign";
const mock = vi.hoisted(() => ({ writable: true, overview: vi.fn(), groups: vi.fn(), create: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/src/config", async (original) => ({ ...await original<typeof import("@/src/config")>(), get WRITES_ENABLED() { return mock.writable; } }));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidate }));
vi.mock("@/src/lib/bot-client", async (original) => ({ ...await original<typeof import("@/src/lib/bot-client")>(), getOverview: mock.overview, getConfiguration: mock.overview, getCapabilities: async () => (await mock.overview()).writes, getGroups: mock.groups, createCampaign: mock.create }));
import { BotUnavailableError, WriteRefusedError } from "@/src/lib/bot-client";
import { createCampaignAction } from "@/app/campaigns/new/actions";
beforeEach(() => {
  vi.clearAllMocks(); mock.writable = true;
  mock.overview.mockResolvedValue({ writes: { enabled: true, affectsProduction: true, fields: {}, delete: [], campaignCreation: { create: true, images: true, scheduling: true } } });
  mock.groups.mockResolvedValue({ groups: [{ jid: "1@g.us", status: "active" }] });
  mock.create.mockResolvedValue({ slug: "demo", scheduling: "ready" });
});
describe("create campaign action", () => {
  it("saves through the bot and refreshes affected pages", async () => {
    expect(await createCampaignAction(validCampaign())).toEqual({ ok: true, slug: "demo", scheduling: "ready" });
    expect(mock.create).toHaveBeenCalledWith(validCampaign()); expect(mock.revalidate).toHaveBeenCalledWith("/schedule");
  });
  it("refuses read-only mode before reads", async () => { mock.writable = false; expect((await createCampaignAction(validCampaign())).ok).toBe(false); expect(mock.overview).not.toHaveBeenCalled(); });
  it("shows the bot's transactional membership refusal", async () => { mock.create.mockRejectedValue(new WriteRefusedError("Group is no longer active", [], 409)); expect(await createCampaignAction(validCampaign())).toMatchObject({ ok: false, detail: "Group is no longer active", outcome: "not-created" }); });
  it("refuses older bots", async () => { mock.overview.mockResolvedValue({ writes: { enabled: true, affectsProduction: true, fields: {}, delete: [] } }); expect((await createCampaignAction(validCampaign())).ok).toBe(false); expect(mock.create).not.toHaveBeenCalled(); });
  it("reports a saved campaign with pending scheduling as saved", async () => { mock.create.mockResolvedValue({ slug: "demo", scheduling: "pending", warning: "retrying" }); expect(await createCampaignAction(validCampaign())).toMatchObject({ ok: true, scheduling: "pending" }); });
  it("classifies a failed preflight read as no creation attempt", async () => {
    mock.overview.mockRejectedValue(new BotUnavailableError("Overview unavailable"));
    expect(await createCampaignAction(validCampaign())).toMatchObject({ ok: false, outcome: "not-created" });
    expect(mock.create).not.toHaveBeenCalled();
  });
  it("classifies a lost creation response as unknown", async () => {
    mock.create.mockRejectedValue(new BotUnavailableError("Response timed out"));
    expect(await createCampaignAction(validCampaign())).toMatchObject({ ok: false, outcome: "unknown" });
  });
  it("treats a service failure after submission as possibly committed", async () => {
    mock.create.mockRejectedValue(new WriteRefusedError("Firestore unavailable", [], 503));
    expect(await createCampaignAction(validCampaign())).toMatchObject({ ok: false, outcome: "unknown" });
  });
});
