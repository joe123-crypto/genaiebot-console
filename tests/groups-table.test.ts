// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupsTable } from "@/app/groups/_components/groups-table";
import { DEFAULT_GROUP_FILTER } from "@/src/domains/group-filter";
import type { Group } from "@/src/lib/types";

function group(overrides: Partial<Group> & Pick<Group, "jid">): Group {
  return {
    name: null,
    source: "whatsapp",
    status: "active",
    activity: "normal",
    account: "default",
    dailyCapOverride: null,
    promos: [],
    weekly: {},
    note: null,
    cap: 2,
    replyScore: null,
    allowedToday: [],
    ...overrides,
  };
}

const market = group({ jid: "120363111@g.us", name: "Harare Market", promos: ["borehole"] });
const nameless = group({ jid: "120363222@g.us", account: "ads", activity: "busy" });
const held = group({ jid: "120363333@g.us", name: "Held Back", status: "on-hold", account: "ads" });
const groups = [market, nameless, held];

const props = {
  groups,
  disabledPromos: [] as string[],
  writesEnabled: false,
  initialFilter: DEFAULT_GROUP_FILTER,
};

function mount(overrides: Partial<typeof props> = {}) {
  return render(createElement(GroupsTable, { ...props, ...overrides }));
}

/** Body rows only — the header row is in its own section. */
function rows() {
  const [body] = screen.getAllByRole("rowgroup").slice(1);
  return within(body).queryAllByRole("row");
}
function names() {
  return rows()
    .map((row) => row.querySelector(".cell-strong")?.textContent ?? "")
    .filter(Boolean);
}
const searchBox = () => screen.getByRole("searchbox");
const count = () => screen.getByRole("status").textContent;

function pick(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function type(value: string) {
  fireEvent.change(searchBox(), { target: { value } });
}

beforeEach(() => {
  window.history.replaceState(null, "", "/groups");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("rendering", () => {
  it("lists every group, needing a decision first", () => {
    mount();
    expect(names()).toEqual(["Held Back", "Harare Market", "Unnamed group"]);
    expect(count()).toBe("Showing all 3 groups");
  });

  it("adds the actions column only when writes are on", () => {
    mount();
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
    cleanup();
    mount({ writesEnabled: true });
    expect(screen.getAllByRole("button", { name: /^Delete/ })).toHaveLength(3);
    // A nameless row confirms by jid, which is the only thing unique to it.
    expect(screen.getByRole("button", { name: "Delete 120363222" })).toBeTruthy();
  });

  it("renders already filtered when the server parsed a filter from the URL", () => {
    mount({ initialFilter: { ...DEFAULT_GROUP_FILTER, status: "on-hold" } });
    expect(names()).toEqual(["Held Back"]);
  });
});

describe("searching", () => {
  it("narrows as the key goes down, with no timers involved", () => {
    mount();
    type("harare");
    expect(names()).toEqual(["Harare Market"]);
    expect(count()).toBe("Showing 1 of 3 groups");
  });

  it("finds a group by its id", () => {
    mount();
    type("120363222");
    expect(names()).toEqual(["Unnamed group"]);
  });

  it("says so when nothing matches", () => {
    mount();
    type("nothing here");
    expect(names()).toEqual([]);
    expect(screen.getByText("No group matches these filters.")).toBeTruthy();
  });

  it("distinguishes an empty record from an empty result", () => {
    mount({ groups: [] });
    expect(screen.getByText("No groups on record.")).toBeTruthy();
  });
});

describe("facets", () => {
  it("narrows by line, tier, campaign and status", () => {
    mount();
    pick("Line", "ads");
    expect(names()).toEqual(["Held Back", "Unnamed group"]);

    pick("Tier", "busy");
    expect(names()).toEqual(["Unnamed group"]);

    pick("Tier", "");
    pick("Line", "");
    pick("Campaign", "borehole");
    expect(names()).toEqual(["Harare Market"]);

    pick("Campaign", "");
    pick("Status", "needs-decision");
    expect(names()).toEqual(["Held Back"]);
  });

  it("combines a search with a facet", () => {
    mount();
    pick("Line", "ads");
    type("held");
    expect(names()).toEqual(["Held Back"]);
  });

  it("keeps a selected line whose groups have gone, and says the filter is empty", () => {
    mount({ initialFilter: { ...DEFAULT_GROUP_FILTER, line: "retired" } });
    const select = screen.getByLabelText("Line") as HTMLSelectElement;
    expect(select.value).toBe("retired");
    expect(within(select).getByText("retired (no groups)")).toBeTruthy();
    expect(screen.getByText("No group matches these filters.")).toBeTruthy();
  });

  it("disables a facet that has nothing to offer", () => {
    mount({ groups: [] });
    expect((screen.getByLabelText("Campaign") as HTMLSelectElement).disabled).toBe(true);
  });

  it("marks a switched-off campaign in the list", () => {
    mount({ disabledPromos: ["borehole"] });
    expect(within(screen.getByLabelText("Campaign")).getByText("Borehole (off)")).toBeTruthy();
  });
});

describe("clearing", () => {
  it("is off until something is filtered, then restores every row", () => {
    mount();
    const clear = () => screen.getByRole("button", { name: "Clear filters" }) as HTMLButtonElement;
    expect(clear().disabled).toBe(true);

    type("harare");
    pick("Line", "default");
    expect(clear().disabled).toBe(false);

    fireEvent.click(clear());
    expect(names()).toHaveLength(3);
    expect((searchBox() as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Line") as HTMLSelectElement).value).toBe("");
  });

  it("hands focus back to the search box, which the disabled button cannot keep", () => {
    mount();
    type("harare");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(document.activeElement).toBe(searchBox());
  });
});

describe("the URL", () => {
  function settle() {
    act(() => {
      vi.advanceTimersByTime(300);
    });
  }

  it("carries the filter once typing pauses", () => {
    vi.useFakeTimers();
    mount();
    type("market");
    pick("Line", "ads");
    settle();
    expect(window.location.pathname + window.location.search).toBe("/groups?q=market&line=ads");
  });

  it("goes back to a clean path when the filter is cleared", () => {
    vi.useFakeTimers();
    mount();
    type("market");
    settle();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    settle();
    expect(window.location.search).toBe("");
  });

  it("leaves a parameter it knows nothing about alone", () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/groups?date=2026-11-07");
    mount();
    type("market");
    settle();
    expect(window.location.search).toContain("date=2026-11-07");
    expect(window.location.search).toContain("q=market");
  });

  it("writes no history entry when nothing changed", () => {
    vi.useFakeTimers();
    mount();
    const replace = vi.spyOn(window.history, "replaceState");
    settle();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("the 60s refresh", () => {
  it("leaves the filter, the typed query and the focus alone", () => {
    // AutoRefresh re-renders the server page from the SAME url, so the filter
    // it parses comes back equal. Anything that reseeded state from it would
    // reset the box mid-keystroke.
    const view = mount();
    type("harare");
    pick("Line", "default");
    searchBox().focus();

    view.rerender(
      createElement(GroupsTable, {
        ...props,
        groups: [...groups, group({ jid: "120363999@g.us", name: "Brand New" })],
        initialFilter: { ...DEFAULT_GROUP_FILTER },
      }),
    );

    expect((searchBox() as HTMLInputElement).value).toBe("harare");
    expect((screen.getByLabelText("Line") as HTMLSelectElement).value).toBe("default");
    expect(document.activeElement).toBe(searchBox());
    expect(names()).toEqual(["Harare Market"]);
  });

  it("does not snap back a search typed since the url was last written", () => {
    // The nasty interleaving: the debounce has put ?q=harare in the url, more
    // has been typed since, and the refresh lands carrying that older query.
    vi.useFakeTimers();
    const view = mount();
    type("harare");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    type("harare market");

    view.rerender(
      createElement(GroupsTable, {
        ...props,
        initialFilter: { ...DEFAULT_GROUP_FILTER, q: "harare" },
      }),
    );

    expect((searchBox() as HTMLInputElement).value).toBe("harare market");
  });
});

describe("a link followed while already on the page", () => {
  it("applies the filter it asked for", () => {
    // A Needs attention link re-renders this table rather than remounting it,
    // so an initial-only filter would leave the url and the rows disagreeing.
    const view = mount();
    expect(names()).toHaveLength(3);

    view.rerender(
      createElement(GroupsTable, {
        ...props,
        initialFilter: { ...DEFAULT_GROUP_FILTER, status: "on-hold" },
      }),
    );

    expect(names()).toEqual(["Held Back"]);
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("on-hold");
  });

  it("replaces a filter the operator had already set", () => {
    const view = mount();
    type("harare");
    expect(names()).toEqual(["Harare Market"]);

    view.rerender(
      createElement(GroupsTable, {
        ...props,
        initialFilter: { ...DEFAULT_GROUP_FILTER, status: "on-hold" },
      }),
    );

    expect((searchBox() as HTMLInputElement).value).toBe("");
    expect(names()).toEqual(["Held Back"]);
  });

  it("brings new rows in under the filter already set", () => {
    const view = mount();
    pick("Line", "ads");
    expect(names()).toEqual(["Held Back", "Unnamed group"]);

    view.rerender(
      createElement(GroupsTable, {
        ...props,
        groups: [...groups, group({ jid: "120363999@g.us", name: "Fresh Ads", account: "ads" })],
      }),
    );
    expect(names()).toEqual(["Held Back", "Unnamed group", "Fresh Ads"]);
    expect(count()).toBe("Showing 3 of 4 groups");
  });
});
