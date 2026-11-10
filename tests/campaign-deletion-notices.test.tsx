// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ campaigns: vi.fn() }));
vi.mock("@/src/lib/bot-client", () => ({ getCampaignsPayload: api.campaigns, BotUnavailableError: class extends Error {} }));
vi.mock("@/app/_components/shell-wrapper", () => ({ Shell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/src/domains/console", async (original) => ({ ...await original<object>(), loadOverview: async () => ({ ok: true, overview: {} }) }));
vi.mock("@/app/campaigns/_components/campaigns-table", () => ({ CampaignsTable: () => null }));
import CampaignsPage from "@/app/campaigns/page";
afterEach(cleanup);
it("shows durable pending and complete cleanup status after reloading the page", async () => {
  api.campaigns.mockResolvedValue({ campaigns: [], deletions: [{ slug: "cv", name: "CV", cleanup: "pending", detail: "Waiting for pictures" }] });
  const view = render(await CampaignsPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("status").textContent).toContain("CV deleted.");
  expect(screen.getByRole("status").textContent).toContain("Waiting for pictures");
  api.campaigns.mockResolvedValue({ campaigns: [], deletions: [{ slug: "cv", name: "CV", cleanup: "complete" }] });
  view.rerender(await CampaignsPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("status").textContent).toContain("Cleanup complete.");
  expect(screen.getByRole("status").textContent).not.toContain("pending");
});
