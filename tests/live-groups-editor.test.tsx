// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GroupsTable } from "@/app/groups/_components/groups-table";
import { DEFAULT_GROUP_FILTER } from "@/src/domains/group-filter";
import type { Group } from "@/src/lib/types";
import type { WriteOutcome } from "@/src/lib/write-outcome";
const { update, addCampaigns } = vi.hoisted(() => ({ update: vi.fn(), addCampaigns: vi.fn() }));
vi.mock("@/app/groups/actions", () => ({ updateGroupAction: update, addGroupCampaignAction: addCampaigns, deleteGroupAction: vi.fn() }));
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

it("adds campaigns selected across searches in one request and keeps them selected on failure", async () => {
  vi.useFakeTimers();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const query = new URL(url, window.location.href).searchParams.get("q");
    return Response.json({ rows: query === "design"
      ? [{ slug: "web-design", name: "Web Design" }]
      : [{ slug: "cv", name: "CV" }, { slug: "fruit-trees", name: "Fruit Trees" }] });
  }));
  let resolve!: (outcome: WriteOutcome) => void;
  addCampaigns.mockReturnValueOnce(new Promise<WriteOutcome>((done) => { resolve = done; }))
    .mockResolvedValueOnce({ ok: true });

  render(<GroupsTable {...props} campaignGate={gate} groups={[group]} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add campaign to Market" })));
  expect(screen.queryByRole("checkbox", { name: "CV" })).toBeNull();
  expect((screen.getByRole("button", { name: "Add 0 selected" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Fruit Trees" }));
  fireEvent.change(screen.getByRole("searchbox", { name: "Search campaigns" }), { target: { value: "design" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(screen.queryByRole("checkbox", { name: "Fruit Trees" })).toBeNull();
  const design = screen.getByRole("checkbox", { name: "Web Design" }) as HTMLInputElement;
  fireEvent.click(design);
  expect(addCampaigns).not.toHaveBeenCalled();
  const submit = screen.getByRole("button", { name: "Add 2 selected" });
  fireEvent.click(submit);
  fireEvent.click(submit);
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(addCampaigns).toHaveBeenCalledExactlyOnceWith(group.jid, ["fruit-trees", "web-design"]);

  await act(async () => resolve({ ok: false, detail: "Try again later." }));
  expect(screen.getByRole("alert").textContent).toBe("Try again later.");
  expect(design.checked).toBe(true);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add 2 selected" })));
  expect(addCampaigns).toHaveBeenLastCalledWith(group.jid, ["fruit-trees", "web-design"]);
  expect(screen.queryByRole("dialog")).toBeNull();
});
