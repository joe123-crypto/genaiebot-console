// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ campaigns: vi.fn() }));
vi.mock("@/src/lib/bot-client", () => ({ getCampaignsPayload: api.campaigns, getCapabilities: async () => undefined, BotUnavailableError: class extends Error {} }));
vi.mock("@/app/_components/shell-wrapper", () => ({ Shell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/src/domains/console", async (original) => ({ ...await original<object>(), loadOverview: async () => ({ ok: true, overview: {} }) }));
vi.mock("@/app/campaigns/_components/campaigns-table", () => ({ CampaignsTable: () => null }));
import { LiveCampaigns } from "@/app/campaigns/_components/live-campaigns";
import { DEFAULT_CAMPAIGN_FILTER } from "@/src/domains/campaign-filter";
afterEach(cleanup);
it("shows pending cleanup and drops finished deletions, whose records the bot keeps for good", () => {
  const initial = { rows: [], revision: "1", sync: { revision: "1", syncedAt: "2026-11-10T00:00:00Z", stale: false, state: "live" as const },
    deletions: [{ slug: "cv", name: "CV", cleanup: "pending" as const, detail: "Waiting for pictures" },
      { slug: "old-sale", name: "Old Sale", cleanup: "complete" as const }] };
  render(<LiveCampaigns initial={initial} filter={DEFAULT_CAMPAIGN_FILTER} writable={false} />);
  expect(screen.getByText(/CV deleted/).textContent).toContain("Waiting for pictures");
  expect(screen.queryByText(/Old Sale deleted/)).toBeNull();
  expect(screen.queryByText(/Cleanup complete/)).toBeNull();
});
