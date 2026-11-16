// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Group } from "@/src/lib/types";
import type { WriteGate } from "@/src/lib/write-capabilities";

const { remove } = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock("@/app/groups/actions", () => ({
  removeGroupCampaignAction: remove, addGroupCampaignAction: vi.fn(),
  addGroupCampaignsAction: vi.fn(), updateGroupAction: vi.fn(), deleteGroupAction: vi.fn(),
}));

import { GroupsTable } from "@/app/groups/_components/groups-table";
import { DEFAULT_GROUP_FILTER } from "@/src/domains/group-filter";

const jid = "120363111@g.us";

function group(overrides: Partial<Group> = {}): Group {
  return {
    jid, name: "Harare Market", source: "operator", status: "active", activity: "normal",
    account: "default", dailyCapOverride: null, promos: ["fruit-trees", "borehole-drilling"],
    weekly: { "borehole-drilling": ["mon"] }, pausedPromos: ["borehole-drilling"],
    note: null, cap: 4, replyScore: null, allowedToday: ["fruit-trees"], ...overrides,
  };
}

const props = {
  groups: [group()],
  disabledPromos: [] as string[],
  writesEnabled: true,
  removeGate: { allowed: true } as WriteGate,
  campaignGate: { allowed: false, reason: "not here" } as WriteGate,
  initialFilter: DEFAULT_GROUP_FILTER,
  remote: { onFilter: () => {}, total: 1, lines: [], campaigns: [], tiers: [] },
};

function mount(overrides: Partial<typeof props> = {}) {
  return render(createElement(GroupsTable, { ...props, ...overrides }));
}
const removeButton = (campaign: string) =>
  screen.getByRole("button", { name: `Remove ${campaign} from Harare Market` }) as HTMLButtonElement;

beforeEach(() => {
  window.history.replaceState(null, "", "/groups");
  remove.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); remove.mockReset(); });

describe("removing a campaign from the group's chip", () => {
  it("offers one remove control per chip, naming both the campaign and the group", () => {
    mount();
    expect(removeButton("Fruit Trees")).toBeTruthy();
    expect(removeButton("Borehole Drilling")).toBeTruthy();
    // The chip keeps saying what it said before: the control is an addition.
    expect(screen.getByText(/Borehole Drilling · mon · paused/)).toBeTruthy();
  });

  it("removes on a single click, with no confirmation, and tells the page to refresh", async () => {
    const changed = vi.fn();
    window.addEventListener("genaie:changed", changed);
    mount();
    await act(async () => { fireEvent.click(removeButton("Borehole Drilling")); });
    expect(remove).toHaveBeenCalledExactlyOnceWith(jid, "borehole-drilling");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(changed).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).toBeNull();
    window.removeEventListener("genaie:changed", changed);
  });

  it("says why a refused removal did not happen, and leaves the chip where it is", async () => {
    remove.mockResolvedValue({ ok: false, detail: "This group is no longer on record." });
    mount();
    await act(async () => { fireEvent.click(removeButton("Fruit Trees")); });
    expect(screen.getByRole("alert").textContent).toBe("This group is no longer on record.");
    expect(removeButton("Fruit Trees")).toBeTruthy();
  });

  it("holds the chip until the answer comes, so a second click cannot resend it", async () => {
    let answer: (outcome: { ok: true }) => void = () => {};
    remove.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    mount();
    await act(async () => { fireEvent.click(removeButton("Fruit Trees")); });
    expect(removeButton("Fruit Trees").disabled).toBe(true);
    fireEvent.click(removeButton("Fruit Trees"));
    expect(remove).toHaveBeenCalledOnce();
    await act(async () => { answer({ ok: true }); });
    expect(removeButton("Fruit Trees").disabled).toBe(false);
  });

  it("removes from a group that cannot be added to, where adding stays disabled", () => {
    mount({ groups: [group({ status: "on-hold" })], campaignGate: { allowed: true } });
    expect(removeButton("Fruit Trees").disabled).toBe(false);
    const add = screen.getByRole("button", { name: "Add campaign to Harare Market" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
  });

  it.each([
    ["the console is read-only", { writesEnabled: false }],
    ["the bot will not take one of the fields", { removeGate: { allowed: false, reason: "no" } as WriteGate }],
    ["no gate was passed at all", { removeGate: undefined }],
  ])("offers nothing when %s", (_why, overrides) => {
    mount(overrides as Partial<typeof props>);
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
    expect(screen.getByText("Fruit Trees")).toBeTruthy();
  });
});
