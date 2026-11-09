// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Group } from "@/src/lib/types";

const { remove } = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock("@/app/groups/actions", () => ({
  deleteGroupAction: remove,
  addGroupCampaignAction: vi.fn(),
  updateGroupAction: vi.fn(),
}));

import { GroupsTable } from "@/app/groups/_components/groups-table";
import { DEFAULT_GROUP_FILTER } from "@/src/domains/group-filter";

/**
 * A delete that half-worked has to be reported somewhere that outlives the row.
 *
 * The delete succeeds, the action revalidates /groups, and the refreshed list
 * no longer contains the group -- so anything rendered inside that row unmounts
 * and takes the warning with it. This drives the real table and then removes
 * the group from its props, which is exactly what the revalidation does.
 */
function group(overrides: Partial<Group> & Pick<Group, "jid">): Group {
  return {
    name: null, source: "whatsapp", status: "active", activity: "normal",
    account: "default", dailyCapOverride: null, promos: [], weekly: {},
    note: null, cap: 2, replyScore: null, allowedToday: [], ...overrides,
  };
}

const market = group({ jid: "120363111@g.us", name: "Harare Market" });
const other = group({ jid: "120363222@g.us", name: "Second Group" });

const ARMED = { allowed: true } as const;
const props = {
  groups: [market, other],
  disabledPromos: [] as string[],
  writesEnabled: true,
  initialFilter: DEFAULT_GROUP_FILTER,
  editing: {
    edit: ARMED, editableFields: ["name"], delete: ARMED,
    leave: ARMED, clearRecords: ARMED,
    lines: ["default"], tiers: ["busy", "normal", "quiet"],
  },
};

afterEach(() => {
  cleanup();
  remove.mockReset();
});

async function deleteMarket() {
  fireEvent.click(screen.getByRole("button", { name: "Delete Harare Market" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Also take the bot/ }));
  fireEvent.change(screen.getByLabelText(/Type/), { target: { value: "Harare Market" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Delete group" }));
  });
}

describe("a half-done delete, in the real table", () => {
  it("keeps the warning after the deleted row is gone", async () => {
    remove.mockResolvedValue({
      ok: true,
      warnings: ["The bot could not leave the WhatsApp group, so its number is still in it."],
    });
    const view = render(createElement(GroupsTable, props));

    await deleteMarket();
    expect(screen.getByText(/still in it/)).toBeTruthy();

    // What the revalidation does: the group is no longer on record.
    view.rerender(createElement(GroupsTable, { ...props, groups: [other] }));

    expect(screen.queryByRole("button", { name: "Delete Harare Market" })).toBeNull();
    expect(screen.getByText(/still in it/)).toBeTruthy();
    expect(screen.getByText(/Deleted Harare Market/)).toBeTruthy();
  });

  it("can be dismissed once it has been read", async () => {
    remove.mockResolvedValue({ ok: true, warnings: ["Leaving was not confirmed."] });
    render(createElement(GroupsTable, props));

    await deleteMarket();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByText(/Leaving was not confirmed/)).toBeNull();
  });

  it("says nothing when the delete came off whole", async () => {
    remove.mockResolvedValue({ ok: true });
    const view = render(createElement(GroupsTable, props));

    await deleteMarket();
    view.rerender(createElement(GroupsTable, { ...props, groups: [other] }));

    expect(screen.queryByText(/Deleted Harare Market/)).toBeNull();
    expect(document.querySelector(".groups-table-notice")).toBeNull();
  });
});
