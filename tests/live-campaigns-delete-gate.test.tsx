// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/app/campaigns/actions", () => ({ setCampaignEnabledAction: vi.fn(), deleteCampaignAction: vi.fn() }));
import { LiveCampaigns } from "@/app/campaigns/_components/live-campaigns";
import { DEFAULT_CAMPAIGN_FILTER } from "@/src/domains/campaign-filter";
import { campaign } from "./fixtures/campaign-detail";
import type { CampaignRow, LivePage } from "@/src/lib/live-types";
import type { WriteCapabilities } from "@/src/lib/types";

const { captions, images, assets, script, ...summary } = campaign;
const row: CampaignRow = { ...summary, captionCount: 3, imageCount: 4, thumbnailUrl: null };
const sync = { revision: "1", state: "live" as const, stale: false, syncedAt: "2026-11-10T10:00:00Z" };
const LIVE: WriteCapabilities = { enabled: true, affectsProduction: true, fields: { campaigns: ["enabled"] }, delete: [] };
const page = (writes?: WriteCapabilities): LivePage<CampaignRow> =>
  ({ rows: [row], revision: "1", sync, total: 1, nextCursor: null, ...(writes ? { context: { writes } } : {}) } as LivePage<CampaignRow>);
const mount = (initial: LivePage<CampaignRow> | null, writable = true) =>
  render(<LiveCampaigns initial={initial} filter={DEFAULT_CAMPAIGN_FILTER} writable={writable} />);

beforeEach(() => {
  window.history.replaceState(null, "", "/campaigns");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ unchanged: true, revision: "1", sync })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** The bot sends its own reason -- a missing GENAIE_CAMPAIGN_DELETION or R2 credential -- and it
 * used to reach the screen only as `title` on a disabled button, which Chrome never shows because
 * disabled controls take no pointer events. The operator saw a dead button and no explanation. */
it("names the bot's reason for a trash button it has disabled", () => {
  mount(page({ ...LIVE, campaignDeletion: { delete: false, reason: "Set GENAIE_CAMPAIGN_DELETION=1 on the bot." } }));
  expect(screen.getByText(/Deleting campaigns is unavailable/).textContent).toContain("Set GENAIE_CAMPAIGN_DELETION=1 on the bot.");
  expect((screen.getByRole("button", { name: `Delete ${row.name}` }) as HTMLButtonElement).disabled).toBe(true);
});

it("falls back to the console's own wording when the bot sends no reason", () => {
  mount(page(LIVE));
  expect(screen.getByText(/Deleting campaigns is unavailable/).textContent).toContain("Deploy the companion bot update for campaign deletion");
});

it("says nothing once deletion is available", () => {
  mount(page({ ...LIVE, campaignDeletion: { delete: true } }));
  expect(screen.queryByText(/Deleting campaigns is unavailable/)).toBeNull();
  expect((screen.getByRole("button", { name: `Delete ${row.name}` }) as HTMLButtonElement).disabled).toBe(false);
});

/** With CONSOLE_WRITES off there is no Actions column to explain, and before the first payload
 * the gate reports an older bot -- a wrong reason to put beside a plain connection failure. */
it("stays quiet when the console is read-only or nothing has loaded", () => {
  mount(page(LIVE), false);
  expect(screen.queryByText(/Deleting campaigns is unavailable/)).toBeNull();
  cleanup();
  mount(null);
  expect(screen.queryByText(/Deleting campaigns is unavailable/)).toBeNull();
});
