// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apply } = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock("@/app/campaigns/actions", () => ({ applyCampaignGroupsAction: apply }));

import { CampaignGroups } from "@/app/campaigns/_components/campaign-groups";
import {
  groupDraftKey, type CampaignGroupRow, type KnownCampaignGroup,
} from "@/src/lib/campaign-group-draft";

const live: CampaignGroupRow[] = [{
  jid: "1@g.us", name: "Market One", account: "default", contactNumber: "+263123",
  ref: "BH-ONE", variant: 1, sendsToday: true, allowedToday: ["borehole"], weekly: ["mon", "thu"],
}, {
  jid: "2@g.us", name: "Market Two", account: "ads", contactNumber: "+263456",
  ref: "BH-TWO", variant: 0, sendsToday: false, allowedToday: ["cv"], weekly: [],
}];
const known: KnownCampaignGroup[] = [
  ...live.map(({ jid, name, account }) => ({ jid, name, account, status: "active" as const })),
  { jid: "3@g.us", name: "New Market", account: "sales", status: "active" },
  { jid: "4@g.us", name: "Other Market", account: "ads", status: "active" },
  { jid: "5@g.us", name: "Held Market", account: "default", status: "on-hold" },
  { jid: "6@g.us", name: "Admin Market", account: "default", status: "admin-only" },
  { jid: "7@g.us", name: "Left Market", account: "default", status: "not-a-member" },
];
const props = { slug: "borehole", liveGroups: live, knownGroups: known, variantCount: 3 };
function mount(overrides: Partial<typeof props> = {}) {
  return render(createElement(CampaignGroups, { ...props, ...overrides }));
}
function click(name: string) { fireEvent.click(screen.getByRole("button", { name })); }
function remove(name: string) {
  click(`Remove ${name} from campaign`);
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove group" }));
}
function picker() {
  screen.getByRole("button", { name: "Add groups" }).focus();
  click("Add groups");
  return screen.getByRole("dialog");
}
function select(dialog: HTMLElement, name: string) {
  fireEvent.click(within(dialog).getByRole("checkbox", { name: new RegExp(name) }));
}
function stored(slug = props.slug) {
  const raw = localStorage.getItem(groupDraftKey(slug));
  return raw ? JSON.parse(raw) : null;
}
function storageEvent(key: string | null, newValue: string | null, storageArea = localStorage) {
  fireEvent(window, new StorageEvent("storage", { key, newValue, storageArea }));
}
function row(name: string) { return screen.getByText(name).closest("tr")!; }
beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); apply.mockReset(); });

describe("campaign group drafts", () => {
  it("loads the full directory only when Add groups is opened", async () => {
    const loadChoices = vi.fn().mockResolvedValue(known);
    render(createElement(CampaignGroups, { ...props, knownGroups: known.slice(0, 2), loadChoices }));
    expect(loadChoices).not.toHaveBeenCalled();
    click("Add groups");
    await screen.findByRole("dialog");
    expect(loadChoices).toHaveBeenCalledWith();
    expect(screen.getByRole("checkbox", { name: /New Market/ })).toBeTruthy();
  });

  it("checks saved draft additions by ID and retains them while the check is pending", async () => {
    const saved = { version: 1, added: ["3@g.us"], removed: [], paused: [] };
    localStorage.setItem(groupDraftKey(props.slug), JSON.stringify(saved));
    let finish!: (groups: KnownCampaignGroup[]) => void;
    const loadChoices = vi.fn(() => new Promise<KnownCampaignGroup[]>((resolve) => { finish = resolve; }));
    render(createElement(CampaignGroups, { ...props, knownGroups: known.slice(0, 2), loadChoices }));
    expect(loadChoices).toHaveBeenCalledWith(["3@g.us"]);
    expect(stored().added).toEqual(["3@g.us"]);
    await act(async () => { finish([known[2]]); });
    await waitFor(() => expect(screen.getByText("New Market")).toBeTruthy());
    expect(stored().added).toEqual(["3@g.us"]);
    expect(loadChoices).toHaveBeenCalledTimes(1);
  });

  it.each([null, { version: 1, added: [], removed: [], paused: ["1@g.us"] }])(
    "does not overwrite another tab’s newer draft before its storage event arrives (initial: %j)", (initial) => {
      if (initial) localStorage.setItem(groupDraftKey(props.slug), JSON.stringify(initial));
      const view = mount();
      const external = { version: 1, added: ["3@g.us"], removed: ["2@g.us"], paused: ["3@g.us"] };
      localStorage.setItem(groupDraftKey(props.slug), JSON.stringify(external));
      view.rerender(createElement(CampaignGroups, { ...props, liveGroups: [...live], knownGroups: [...known] }));
      expect(stored()).toEqual(external);
      expect(screen.queryByText("Market Two")).toBeNull();
      expect(within(row("New Market")).getByText("Paused · draft")).toBeTruthy();
    });

  it("synchronizes additions and pauses from another tab without echoing writes or replaying older events", () => {
    mount();
    const key = groupDraftKey(props.slug);
    const external = { version: 1, added: ["3@g.us"], removed: ["2@g.us"], paused: ["3@g.us"] };
    const raw = JSON.stringify(external);
    localStorage.setItem(key, raw);
    const set = vi.spyOn(Storage.prototype, "setItem");
    const remove = vi.spyOn(Storage.prototype, "removeItem");
    storageEvent(key, raw);
    expect(stored()).toEqual(external);
    expect(within(row("New Market")).getByText("Paused · draft")).toBeTruthy();
    expect(screen.queryByText("Market Two")).toBeNull();
    expect(screen.getByText("Draft updated from another tab.")).toBeTruthy();
    // A delayed event must read current storage, not restore its stale newValue.
    storageEvent(key, JSON.stringify({ ...external, added: [], removed: [], paused: [] }));
    expect(stored()).toEqual(external); expect(screen.getByText("New Market")).toBeTruthy();
    expect(set).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });

  it("synchronizes another tab’s reset and localStorage.clear without restoring an old draft on refresh", () => {
    const view = mount(); const key = groupDraftKey(props.slug);
    click("Pause Market One in this campaign");
    localStorage.removeItem(key); storageEvent(key, null);
    expect(screen.queryByText("Paused · draft")).toBeNull(); expect(stored()).toBeNull();
    click("Pause Market Two in this campaign");
    localStorage.clear(); storageEvent(null, null);
    expect(screen.queryByText("Paused · draft")).toBeNull(); expect(stored()).toBeNull();
    view.rerender(createElement(CampaignGroups, { ...props, liveGroups: [...live], knownGroups: [...known] }));
    expect(stored()).toBeNull();
  });

  it("ignores changes for other campaigns and other storage areas", () => {
    mount(); click("Pause Market One in this campaign"); const before = stored();
    const otherKey = groupDraftKey("cv");
    localStorage.setItem(otherKey, JSON.stringify({ ...before, paused: ["2@g.us"] }));
    storageEvent(otherKey, localStorage.getItem(otherKey));
    storageEvent(groupDraftKey(props.slug), null, sessionStorage);
    expect(stored()).toEqual(before);
    expect(within(row("Market One")).getByText("Paused · draft")).toBeTruthy();
    expect(within(row("Market Two")).getByText("At cap")).toBeTruthy();
  });

  it("warns before removal, focuses Cancel, and leaves the draft unchanged on Cancel or Escape", () => {
    mount(); click("Pause Market One in this campaign");
    const before = stored();
    const trigger = screen.getByRole("button", { name: "Remove Market One from campaign" });
    trigger.focus(); fireEvent.click(trigger);
    let dialog = screen.getByRole("alertdialog", { name: "Remove group from campaign?" });
    expect(within(dialog).getByText("Market One")).toBeTruthy();
    expect(within(dialog).getByText(/campaign’s browser draft/)).toBeTruthy();
    expect(within(screen.getByRole("table")).getByText("Market One")).toBeTruthy();
    expect(stored()).toEqual(before);
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(trigger); expect(stored()).toEqual(before);
    fireEvent.click(trigger); dialog = screen.getByRole("alertdialog");
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("alertdialog")).toBeNull(); expect(stored()).toEqual(before);
    expect(within(row("Market One")).getByText("Paused · draft")).toBeTruthy();
    fireEvent.click(trigger);
    click("Remove group");
    expect(screen.queryByText("Market One")).toBeNull();
    expect(stored()).toEqual({ version: 1, added: [], removed: ["1@g.us"], paused: [] });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add groups" }));
  });

  it("closes a removal warning if its target disappears during refresh", () => {
    const view = mount();
    click("Remove Market One from campaign");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    view.rerender(createElement(CampaignGroups, { ...props, liveGroups: [live[1]] }));
    expect(screen.queryByRole("alertdialog")).toBeNull(); expect(stored()).toBeNull();
    view.rerender(createElement(CampaignGroups, props));
    expect(screen.getByText("Market One")).toBeTruthy(); expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("preserves live details and explains the local-only scope", () => {
    mount();
    expect(screen.getByText("BH-ONE")).toBeTruthy();
    expect(within(row("Market One")).getByText("2/3")).toBeTruthy();
    expect(within(row("Market One")).getByText("mon, thu")).toBeTruthy();
    expect(screen.getByText("At cap")).toBeTruthy();
    expect(screen.getByText("Changes are saved in this browser only and do not affect the bot.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Reset draft" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("selects only existing active unassigned groups, searches all fields, and adds multiple groups", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    mount(); const dialog = picker();
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(2);
    expect(within(dialog).queryByText("Market One")).toBeNull();
    expect(within(dialog).queryByText("Held Market")).toBeNull();
    expect(within(dialog).queryByText("Admin Market")).toBeNull();
    expect(within(dialog).queryByText("Left Market")).toBeNull();
    const search = within(dialog).getByRole("searchbox");
    expect(document.activeElement).toBe(search);
    expect((within(dialog).getByRole("button", { name: "Add selected" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(search, { target: { value: "new market" } }); select(dialog, "New Market");
    fireEvent.change(search, { target: { value: "4@g.us" } }); select(dialog, "Other Market");
    fireEvent.change(search, { target: { value: "sales" } });
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(1);
    expect(within(dialog).getByText("2 selected")).toBeTruthy();
    fireEvent.change(search, { target: { value: "missing" } });
    expect(within(dialog).getByText("No groups match your search.")).toBeTruthy();
    click("Add selected");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add groups" }));
    expect(screen.getAllByText("Draft addition")).toHaveLength(2);
    expect(within(row("New Market")).getByText("daily (draft)")).toBeTruthy();
    expect(within(row("New Market")).getAllByText("—")).toHaveLength(4);
    expect(stored().added).toEqual(["3@g.us", "4@g.us"]);
    expect(fetch).not.toHaveBeenCalled();
    expect(within(picker()).queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByText("No active groups available to add.")).toBeTruthy();
  });

  it("discards selections on Cancel and native Escape cancellation", () => {
    mount(); let dialog = picker(); select(dialog, "New Market"); click("Cancel");
    expect(screen.queryByText("New Market")).toBeNull(); expect(stored()).toBeNull();
    dialog = picker(); select(dialog, "Other Market"); fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull(); expect(stored()).toBeNull();
    dialog = picker();
    expect((within(dialog).getByRole("checkbox", { name: /Other Market/ }) as HTMLInputElement).checked).toBe(false);
    click("Close add groups"); expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("pauses without removing, resumes original cap/cadence details, and resets all changes", () => {
    mount(); click("Pause Market Two in this campaign");
    expect(within(row("Market Two")).getByText("Paused · draft")).toBeTruthy();
    expect(screen.getByText(/2 groups in draft · 1 participating · 1 paused/)).toBeTruthy();
    expect(stored().paused).toEqual(["2@g.us"]);
    click("Resume Market Two in this campaign");
    expect(within(row("Market Two")).getByText("At cap")).toBeTruthy(); expect(stored()).toBeNull();
    click("Pause Market One in this campaign"); remove("Market Two");
    expect(screen.queryByText("Market Two")).toBeNull();
    const dialog = picker(); select(dialog, "New Market"); click("Add selected");
    click("Reset draft");
    expect(screen.getByText("Market Two")).toBeTruthy(); expect(screen.queryByText("New Market")).toBeNull();
    expect(screen.queryByText("Paused · draft")).toBeNull(); expect(stored()).toBeNull();
  });

  it("pauses additions, clears pauses on removal, and readds live groups with their original preview", () => {
    mount(); let dialog = picker(); select(dialog, "New Market"); click("Add selected");
    click("Pause New Market in this campaign");
    expect(within(row("New Market")).getByText("Draft addition")).toBeTruthy();
    click("Resume New Market in this campaign");
    expect(within(row("New Market")).queryByText("Posts")).toBeNull();
    click("Pause New Market in this campaign"); remove("New Market");
    expect(stored()).toBeNull();
    click("Pause Market One in this campaign"); remove("Market One");
    expect(stored().paused).toEqual([]);
    dialog = picker(); select(dialog, "Market One"); click("Add selected");
    expect(within(row("Market One")).getByText("BH-ONE")).toBeTruthy();
    expect(within(row("Market One")).getByText("Posts")).toBeTruthy(); expect(stored()).toBeNull();
  });

  it("restores saved drafts after remount and isolates campaigns even on reused components", () => {
    let view = mount(); const dialog = picker(); select(dialog, "New Market"); click("Add selected");
    click("Pause New Market in this campaign"); remove("Market Two"); view.unmount();
    view = mount();
    expect(within(row("New Market")).getByText("Paused · draft")).toBeTruthy(); expect(screen.queryByText("Market Two")).toBeNull();
    view.rerender(createElement(CampaignGroups, { ...props, slug: "cv" }));
    expect(screen.queryByText("New Market")).toBeNull(); expect(screen.getByText("Market Two")).toBeTruthy();
    click("Pause Market One in this campaign"); expect(stored("cv").paused).toEqual(["1@g.us"]);
    view.rerender(createElement(CampaignGroups, props));
    expect(screen.getByText("New Market")).toBeTruthy(); expect(stored().paused).toEqual(["3@g.us"]);
    expect(within(row("Market One")).queryByText("Paused · draft")).toBeNull();
  });

  it("preserves drafts on refresh and absorbs assignments already applied by the server", () => {
    const view = mount(); const dialog = picker(); select(dialog, "New Market"); click("Add selected");
    click("Pause New Market in this campaign"); remove("Market Two");
    view.rerender(createElement(CampaignGroups, { ...props, liveGroups: [...live], knownGroups: [...known] }));
    expect(screen.queryByText("Market Two")).toBeNull(); expect(screen.getByText("New Market")).toBeTruthy();
    view.rerender(createElement(CampaignGroups, { ...props, liveGroups: [live[0], { ...live[0], jid: "3@g.us", name: "New Market", ref: "BH-NEW" }] }));
    expect(stored()).toEqual({ version: 1, added: [], removed: [], paused: ["3@g.us"] });
    expect(screen.queryByText("Draft addition")).toBeNull();
    expect(within(row("New Market")).getByText("BH-NEW")).toBeTruthy();
  });

  it("drops unknown/inactive additions with a notice and updates an open picker after refresh", () => {
    const view = mount(); let dialog = picker(); select(dialog, "New Market"); select(dialog, "Other Market"); click("Add selected");
    click("Pause New Market in this campaign");
    const refreshed = known.filter((g) => g.jid !== "4@g.us").map((g) => g.jid === "3@g.us" ? { ...g, status: "on-hold" as const } : g);
    view.rerender(createElement(CampaignGroups, { ...props, knownGroups: refreshed }));
    expect(screen.queryByText("New Market")).toBeNull(); expect(screen.queryByText("Other Market")).toBeNull();
    expect(screen.getByText(/2 draft additions removed/)).toBeTruthy(); expect(stored()).toBeNull();
    view.rerender(createElement(CampaignGroups, props)); dialog = picker(); select(dialog, "New Market");
    view.rerender(createElement(CampaignGroups, { ...props, knownGroups: refreshed }));
    expect(within(dialog).getByText("0 selected")).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Add selected" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each(["bad-json", '{"version":2}', '{"version":1,"added":[3],"removed":[],"paused":[]}'])("recovers from malformed storage: %s", (raw) => {
    localStorage.setItem(groupDraftKey(props.slug), raw); mount();
    expect(screen.getByText(/saved group draft could not be read/)).toBeTruthy();
    expect(screen.getByText("Market One")).toBeTruthy(); expect(stored()).toBeNull();
    click("Pause Market One in this campaign"); expect(stored().paused).toEqual(["1@g.us"]);
  });

  it("retains edits in memory on storage read/write failure, reports it, and recovers", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    mount(); click("Pause Market One in this campaign");
    expect(screen.getByText(/Browser storage is unavailable/)).toBeTruthy();
    expect(within(row("Market One")).getByText("Paused · draft")).toBeTruthy();
    click("Reset draft"); expect(screen.queryByText("Paused · draft")).toBeNull();
    get.mockRestore(); remove.mockRestore(); set.mockRestore();
    click("Pause Market Two in this campaign");
    expect(stored().paused).toEqual(["2@g.us"]); expect(screen.queryByText(/Browser storage is unavailable/)).toBeNull();
  });

  it("allows an empty draft and a campaign with no live groups", () => {
    mount(); remove("Market One"); remove("Market Two");
    expect(screen.getByText("No groups in this draft. Add groups to get started.")).toBeTruthy();
    cleanup(); mount({ slug: "empty", liveGroups: [] });
    const dialog = picker(); select(dialog, "New Market"); click("Add selected");
    expect(screen.getByText("Draft addition")).toBeTruthy();
  });
});

describe("applying a campaign's group changes", () => {
  const ALLOWED = { allowed: true as const };
  function mountWith(gate?: Parameters<typeof CampaignGroups>[0]["gate"], liveGroups = live) {
    return render(createElement(CampaignGroups, { ...props, liveGroups, gate }));
  }
  async function confirmApply() {
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Apply changes" }));
    });
  }

  it("offers no Apply while the console is read-only", () => {
    mountWith(undefined);
    expect(screen.queryByRole("button", { name: /^Apply/ })).toBeNull();
  });

  it("disables Apply, saying why, when the bot cannot take the change", () => {
    mountWith({ allowed: false, reason: "The bot has no write key installed, so it cannot save changes yet." });
    click("Pause Market One in this campaign");
    const button = screen.getByRole("button", { name: "Apply 1 change" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/no write key/);
    expect(screen.getByText(/no write key/, { selector: "p" })).toBeTruthy();
    expect(screen.getByText("Changes are saved in this browser only and do not affect the bot.")).toBeTruthy();
  });

  it("confirms, sends the draft, and empties it once applied", async () => {
    apply.mockResolvedValue({ ok: true, done: ["1@g.us"] });
    mountWith(ALLOWED);
    expect((screen.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement).disabled).toBe(true);
    click("Pause Market One in this campaign");
    click("Apply 1 change");
    const dialog = screen.getByRole("alertdialog", { name: "Apply changes to the bot?" });
    expect(within(dialog).getByText(/1 group will change for this campaign: 1 paused/)).toBeTruthy();
    expect(within(dialog).getByText(/next run/)).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
    await confirmApply();
    expect(apply).toHaveBeenCalledWith("borehole", { version: 1, added: [], removed: [], paused: ["1@g.us"] });
    expect(stored()).toBeNull();
    expect(screen.getByText(/Applied to 1 group/)).toBeTruthy();
  });

  it("sends nothing when the confirmation is cancelled", () => {
    mountWith(ALLOWED);
    click("Pause Market One in this campaign");
    click("Apply 1 change");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(apply).not.toHaveBeenCalled();
    expect(stored().paused).toEqual(["1@g.us"]);
  });

  it("keeps what was not applied and names each refusal", async () => {
    apply.mockResolvedValue({
      ok: false, done: ["1@g.us"], detail: "Stopped after 1 of 2 groups; the rest are still in the draft.",
      failures: [{ jid: "2@g.us", detail: "the bot said no", problems: ["group 2: unknown campaign"] }],
    });
    mountWith(ALLOWED);
    click("Pause Market One in this campaign");
    click("Pause Market Two in this campaign");
    click("Apply 2 changes");
    await confirmApply();
    expect(stored().paused).toEqual(["2@g.us"]);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Stopped after 1 of 2 groups/);
    expect(within(alert).getByText("Market Two")).toBeTruthy();
    expect(alert.textContent).toMatch(/the bot said no/);
    expect(alert.textContent).toMatch(/unknown campaign/);
  });

  it("keeps the whole draft when the request itself fails", async () => {
    apply.mockRejectedValue(new Error("network"));
    mountWith(ALLOWED);
    click("Pause Market One in this campaign");
    click("Apply 1 change");
    await confirmApply();
    expect(stored().paused).toEqual(["1@g.us"]);
    expect(screen.getByRole("alert").textContent).toMatch(/reload to see what the bot has now/);
  });

  it("shows a group the bot has paused, and stages resuming it", () => {
    mountWith(ALLOWED, [live[0], { ...live[1], paused: true, sendsToday: false }]);
    expect(within(row("Market Two")).getByText("Paused")).toBeTruthy();
    expect(screen.getByText(/2 groups in draft · 1 participating · 1 paused/)).toBeTruthy();
    click("Resume Market Two in this campaign");
    expect(within(row("Market Two")).getByText("Resumes · draft")).toBeTruthy();
    expect(stored()).toEqual({ version: 1, added: [], removed: [], paused: [], resumed: ["2@g.us"] });
    click("Pause Market Two in this campaign");
    expect(stored()).toBeNull();
  });
});
