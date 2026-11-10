// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GroupsTable } from "@/app/groups/_components/groups-table";
import { DEFAULT_GROUP_FILTER } from "@/src/domains/group-filter";
import type { Group } from "@/src/lib/types";
const update = vi.hoisted(() => vi.fn());
vi.mock("@/app/groups/actions", () => ({ updateGroupAction: update, addGroupCampaignAction: vi.fn(), deleteGroupAction: vi.fn() }));
const group: Group = { jid: "123@g.us", name: "Market", source: "operator", status: "active", activity: "normal", account: "default",
  dailyCapOverride: null, promos: ["cv"], weekly: {}, note: "Original", cap: 4, replyScore: null, allowedToday: [] };
const gate = { allowed: true } as const;
const props = { disabledPromos: [], writesEnabled: true, initialFilter: DEFAULT_GROUP_FILTER,
  editing: { edit: gate, delete: gate, leave: gate, clearRecords: gate, editableFields: ["name", "note"], lines: ["default"], tiers: ["normal"] },
  remote: { onFilter: vi.fn(), total: 1, lines: ["default"], campaigns: [], tiers: ["normal"] } };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("keeps an open draft outside reflowed rows and disables saving after deletion", async () => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ group })).mockResolvedValue(Response.json({ group: null }));
  vi.stubGlobal("fetch", fetch);
  const view = render(<GroupsTable {...props} groups={[group]} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Edit Market" })));
  fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Keep this draft" } });
  view.rerender(<GroupsTable {...props} groups={[]} />);
  expect((screen.getByLabelText("Note") as HTMLTextAreaElement).value).toBe("Keep this draft");
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(screen.getByText(/This group no longer exists/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText("Note") as HTMLTextAreaElement).value).toBe("Keep this draft");
  expect(update).not.toHaveBeenCalled();
});
