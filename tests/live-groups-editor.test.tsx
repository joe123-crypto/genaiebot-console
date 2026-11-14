// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GroupsTable } from "@/app/groups/_components/groups-table";
import { DEFAULT_GROUP_FILTER } from "@/src/domains/group-filter";
import type { Group } from "@/src/lib/types";
import type { WriteOutcome } from "@/src/lib/write-outcome";
const { update, addCampaigns, bulkAdd } = vi.hoisted(() => ({ update: vi.fn(), addCampaigns: vi.fn(), bulkAdd: vi.fn() }));
vi.mock("@/app/groups/actions", () => ({
  updateGroupAction: update, addGroupCampaignAction: addCampaigns, addGroupCampaignsAction: bulkAdd, deleteGroupAction: vi.fn(),
}));
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

it("keeps selected groups across loaded pages, filters and refreshes, and retries the full selection", async () => {
  vi.useFakeTimers();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const query = new URL(url, window.location.href).searchParams.get("q");
    return Response.json({ rows: query === "design"
      ? [{ slug: "web-design", name: "Web Design" }]
      : [{ slug: "cv", name: "CV" }] });
  }));
  bulkAdd.mockReset().mockResolvedValueOnce({ ok: false, refreshLive: true, detail: "Connection lost." })
    .mockResolvedValueOnce({ ok: true });
  const west = { ...group, jid: "456@g.us", name: "West", promos: [] };
  const east = { ...group, jid: "789@g.us", name: "East", promos: [] };
  const held = { ...group, jid: "111@g.us", name: "Held", status: "on-hold" } as const;
  const view = render(<GroupsTable {...props} campaignGate={gate} groups={[group, held]} />);
  expect(screen.queryByRole("checkbox", { name: "Select Held (111)" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Market (123)" }));
  view.rerender(<GroupsTable {...props} campaignGate={gate} groups={[group, held, west]} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select West (456)" }));
  fireEvent.change(screen.getByRole("searchbox", { name: "Search by group name or ID" }), { target: { value: "East" } });
  view.rerender(<GroupsTable {...props} campaignGate={gate} groups={[east]} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select East (789)" }));
  expect(screen.getByText("3 groups selected")).toBeTruthy();
  const open = screen.getByRole("button", { name: "Add campaigns" });
  await act(async () => fireEvent.click(open));
  fireEvent.click(screen.getByText("Add to 3 groups"));
  expect(screen.getByText("Market")).toBeTruthy();
  expect(screen.getByText("West")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("3 groups selected")).toBeTruthy();
  expect(bulkAdd).not.toHaveBeenCalled();

  await act(async () => fireEvent.click(open));
  // CV belongs to Market already, but can still be added to West and East.
  fireEvent.click(screen.getByRole("checkbox", { name: "CV" }));
  fireEvent.change(screen.getByRole("searchbox", { name: "Search campaigns" }), { target: { value: "design" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  fireEvent.click(screen.getByRole("checkbox", { name: "Web Design" }));
  const submit = screen.getByRole("button", { name: "Add 2 selected" });
  await act(async () => fireEvent.click(submit));
  expect(bulkAdd).toHaveBeenCalledExactlyOnceWith([group.jid, west.jid, east.jid], ["cv", "web-design"]);
  expect(screen.getByRole("alert").textContent).toBe("Connection lost.");
  expect(screen.getByText("3 groups selected")).toBeTruthy();
  await act(async () => fireEvent.click(submit));
  expect(bulkAdd).toHaveBeenLastCalledWith([group.jid, west.jid, east.jid], ["cv", "web-design"]);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("0 groups selected")).toBeTruthy();
});

it("enforces the group selection limit and hides bulk controls without write permission", () => {
  const groups = Array.from({ length: 101 }, (_, index) => ({
    ...group, jid: `${index}@g.us`, name: `Market ${index}`,
  }));
  const table = (rows: Group[], writesEnabled = true) =>
    <GroupsTable {...props} writesEnabled={writesEnabled} campaignGate={gate} groups={rows} />;
  const view = render(table(groups.slice(0, 10)));
  for (let offset = 0; offset < 100; offset += 10) {
    view.rerender(table(groups.slice(offset, offset + 10)));
    act(() => {
      view.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((checkbox) => checkbox.click());
    });
  }
  const edge = [groups[0], groups[100]];
  view.rerender(table(edge));
  const checkboxes = screen.getAllByRole<HTMLInputElement>("checkbox");
  expect(checkboxes[1].disabled).toBe(true);
  expect(checkboxes[0].disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(checkboxes[0].checked).toBe(false);
  expect(checkboxes[1].disabled).toBe(false);
  view.rerender(table(edge, false));
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "Add campaigns" })).toBeNull();
}, 30_000);
