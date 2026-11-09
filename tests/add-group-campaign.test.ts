// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Group } from "@/src/lib/types";
import type { WriteOutcome } from "@/src/lib/write-outcome";

const { add } = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("@/app/groups/actions", () => ({
  addGroupCampaignAction: add, updateGroupAction: vi.fn(), deleteGroupAction: vi.fn(),
}));

import { AddGroupCampaign, type GroupCampaignOption } from "@/app/groups/_components/add-group-campaign";
import { GroupsTable } from "@/app/groups/_components/groups-table";
import { DEFAULT_GROUP_FILTER } from "@/src/domains/group-filter";

const group: Group = {
  jid: "120363111@g.us", name: "Harare Market", source: "operator", status: "active",
  activity: "normal", account: "default", dailyCapOverride: null, promos: ["fruit-trees"],
  weekly: {}, note: null, cap: 4, replyScore: null, allowedToday: [],
};
const campaigns: GroupCampaignOption[] = [
  { slug: "fruit-trees", name: "Orchard", enabled: true },
  { slug: "borehole-drilling", name: "Water supply", enabled: true },
  { slug: "skylight-solar", name: "Solar energy", enabled: false },
];
const props: Parameters<typeof AddGroupCampaign>[0] = { group, campaigns, gate: { allowed: true } };
const trigger = () => screen.getByRole("button", { name: "Add campaign to Harare Market" }) as HTMLButtonElement;
const options = () => screen.getByRole("group", { name: "Available campaigns" });

function mount(overrides: Partial<typeof props> = {}) {
  return render(createElement(AddGroupCampaign, { ...props, ...overrides }));
}

beforeEach(() => {
  window.history.replaceState(null, "", "/groups");
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  add.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); add.mockReset(); });

describe("AddGroupCampaign", () => {
  it("lists unassigned campaigns, including ones with no groups, and marks switched-off ones", () => {
    mount();
    fireEvent.click(trigger());
    expect(screen.getByRole("dialog").textContent).toContain("Add campaign to Harare Market");
    expect(within(options()).queryByRole("button", { name: "Fruit Trees" })).toBeNull();
    expect(within(options()).getByRole("button", { name: "Borehole Drilling" })).toBeTruthy();
    expect(within(options()).getByRole("button", { name: "Skylight Solar (off)" })).toBeTruthy();
    expect(add).not.toHaveBeenCalled();
  });

  it("searches by title, slug, or catalog name and explains an empty result", () => {
    mount();
    fireEvent.click(trigger());
    const search = screen.getByRole("searchbox", { name: "Search campaigns" });
    for (const query of [" BOREHOLE DRILLING ", "borehole-drilling", "Water supply"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(within(options()).getAllByRole("button")).toHaveLength(1);
      expect(within(options()).getByRole("button", { name: "Borehole Drilling" })).toBeTruthy();
    }
    fireEvent.change(search, { target: { value: "unknown" } });
    expect(screen.getByText("No campaigns match your search.")).toBeTruthy();
  });

  it("saves a selection immediately and returns focus to the plus button", async () => {
    mount();
    trigger().focus();
    fireEvent.click(trigger());
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
    await act(async () => fireEvent.click(within(options()).getByRole("button", { name: "Borehole Drilling" })));
    expect(add).toHaveBeenCalledWith(group.jid, "borehole-drilling");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("supports Escape and the close button without saving", () => {
    mount();
    trigger().focus();
    fireEvent.click(trigger());
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger());
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Close campaign selector" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(add).not.toHaveBeenCalled();
  });

  it("shows saving progress and prevents duplicate submissions or dismissal while pending", async () => {
    let resolve!: (outcome: WriteOutcome) => void;
    add.mockReturnValue(new Promise<WriteOutcome>((done) => { resolve = done; }));
    mount();
    fireEvent.click(trigger());
    const option = within(options()).getByRole("button", { name: "Borehole Drilling" });
    fireEvent.click(option);
    fireEvent.click(option);
    expect(add).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toBe("Adding…");
    expect(within(options()).getAllByRole("button").every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect((screen.getByRole("searchbox") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Close campaign selector" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => resolve({ ok: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps failures in the selector and permits a retry", async () => {
    add.mockResolvedValueOnce({ ok: false, detail: "The bot refused the change.", problems: ["Try again later."] });
    mount();
    fireEvent.click(trigger());
    await act(async () => fireEvent.click(within(options()).getByRole("button", { name: "Borehole Drilling" })));
    expect(screen.getByRole("alert").textContent).toContain("The bot refused the change.");
    expect(screen.getByRole("alert").textContent).toContain("Try again later.");
    await act(async () => fireEvent.click(within(options()).getByRole("button", { name: "Borehole Drilling" })));
    expect(add).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("handles a rejected server action without closing the selector", async () => {
    add.mockRejectedValueOnce(new Error("Connection lost"));
    mount();
    fireEvent.click(trigger());
    await act(async () => fireEvent.click(within(options()).getByRole("button", { name: "Borehole Drilling" })));
    expect(screen.getByRole("alert").textContent).toBe("The campaign could not be added. Try again.");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it.each([
    [{ gate: { allowed: false, reason: "The bot does not accept changes to promos yet." } }, "The bot does not accept changes to promos yet."],
    [{ group: { ...group, status: "on-hold" } }, "Only active groups can be added to a campaign."],
    [{ campaigns: [] }, "No campaigns are available."],
    [{ campaigns: campaigns.slice(0, 1) }, "All campaigns are already assigned to this group."],
  ] as [Partial<typeof props>, string][])("disables the control with an explanation (%s)", (overrides, reason) => {
    mount(overrides);
    expect(trigger().disabled).toBe(true);
    expect(trigger().title).toBe(reason);
    fireEvent.click(trigger());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("updates available choices and write capability across page refreshes", () => {
    const view = mount();
    fireEvent.click(trigger());
    view.rerender(createElement(AddGroupCampaign, { ...props, group: { ...group, promos: ["fruit-trees", "borehole-drilling"] } }));
    expect(within(options()).queryByRole("button", { name: "Borehole Drilling" })).toBeNull();
    view.rerender(createElement(AddGroupCampaign, { ...props, gate: { allowed: false, reason: "Writes are unavailable." } }));
    expect(screen.getByRole("status").textContent).toBe("Writes are unavailable.");
    expect(within(options()).getAllByRole("button").every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(add).not.toHaveBeenCalled();
  });

  it("displays the existing production warning", () => {
    mount({ gate: { allowed: true, warning: "Saved changes do not affect sending yet." } });
    fireEvent.click(trigger());
    expect(screen.getByText("Saved changes do not affect sending yet.")).toBeTruthy();
  });
});

describe("Groups table campaign controls", () => {
  it("returns focus to the table when a successful assignment filters the row out", async () => {
    const emptyGroup = { ...group, promos: [] };
    const tableProps = {
      groups: [emptyGroup], campaigns, campaignGate: props.gate, disabledPromos: [],
      initialFilter: { ...DEFAULT_GROUP_FILTER, status: "no-campaign" as const }, writesEnabled: true,
    };
    const view = render(createElement(GroupsTable, tableProps));
    fireEvent.click(trigger());
    await act(async () => fireEvent.click(within(options()).getByRole("button", { name: "Borehole Drilling" })));
    view.rerender(createElement(GroupsTable, { ...tableProps, groups: [{ ...emptyGroup, promos: ["borehole-drilling"] }] }));
    expect(screen.queryByRole("button", { name: "Add campaign to Harare Market" })).toBeNull();
    expect(screen.getByText("No group matches these filters.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Groups, scroll horizontally for counts and actions" }));
  });

  it("returns focus to the table when the saved assignment disables the plus button", async () => {
    const tableProps = {
      groups: [group], campaigns: campaigns.slice(0, 2), campaignGate: props.gate,
      disabledPromos: [], initialFilter: DEFAULT_GROUP_FILTER, writesEnabled: true,
    };
    const view = render(createElement(GroupsTable, tableProps));
    fireEvent.click(trigger());
    await act(async () => fireEvent.click(within(options()).getByRole("button", { name: "Borehole Drilling" })));
    view.rerender(createElement(GroupsTable, {
      ...tableProps, groups: [{ ...group, promos: ["fruit-trees", "borehole-drilling"] }],
    }));
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    expect(trigger().disabled).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Groups, scroll horizontally for counts and actions" }));
  });

  it("shows plus beside badges and for groups with no campaigns only when writes are enabled", () => {
    const tableProps = {
      groups: [group, { ...group, jid: "120363222@g.us", name: "Empty group", promos: [] }],
      campaigns, campaignGate: props.gate, disabledPromos: [], initialFilter: DEFAULT_GROUP_FILTER,
    };
    const view = render(createElement(GroupsTable, { ...tableProps, writesEnabled: false }));
    expect(screen.queryByRole("button", { name: /^Add campaign to/ })).toBeNull();
    view.rerender(createElement(GroupsTable, { ...tableProps, writesEnabled: true }));
    expect(screen.getAllByRole("button", { name: /^Add campaign to/ })).toHaveLength(2);
    expect(trigger().closest(".tag-row")?.textContent).toContain("Fruit Trees");
    expect(screen.getByRole("button", { name: "Add campaign to Empty group" }).closest(".tag-row")?.textContent).toContain("none");
    expect(trigger().disabled).toBe(false);
  });
});
