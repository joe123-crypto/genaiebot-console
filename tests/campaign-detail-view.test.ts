// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), save: vi.fn(), apply: vi.fn(), switch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/campaigns/actions", () => ({ saveCaptionsAction: mocks.save,
  applyCampaignGroupsAction: mocks.apply, setCampaignEnabledAction: mocks.switch }));
import { CampaignDetailView } from "@/app/campaigns/_components/campaign-detail-view";
import type { CampaignDetail } from "@/src/domains/campaign-detail";
import { groupDraftKey } from "@/src/lib/campaign-group-draft";
import { failure, healthy, preview, slug, success } from "./fixtures/campaign-detail";

const props = { slug, writable: true, imageUnavailableReason: "Picture editing unavailable" };
function page(detail: CampaignDetail = healthy, selectedSlug = slug) {
  return createElement(CampaignDetailView, { ...props, slug: selectedSlug, detail });
}
function edit() {
  fireEvent.change(screen.getByRole("textbox", { name: "Variant 1" }), { target: { value: "Unsaved water caption" } });
}
function addGroup() {
  fireEvent.click(screen.getByRole("button", { name: "Add groups" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /New Market/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Add selected" }));
}
function stored() { return JSON.parse(localStorage.getItem(groupDraftKey(slug))!); }
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(cleanup);

describe("campaign read resilience", () => {
  it.each(["campaign", "preview", "membership", "writes"] as const)("isolates initial %s failure and recovers", (key) => {
    const view = render(page({ ...healthy, [key]: failure }));
    expect(screen.getByRole("link", { name: "All campaigns" })).toBeTruthy();
    for (const title of ["Pictures", "Caption variants", "Where it goes"]) {
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    }
    if (key !== "preview") expect(screen.getByRole("textbox", { name: "Variant 1" })).toBeTruthy();
    if (key !== "campaign") expect(screen.getByText("borehole.jpg")).toBeTruthy();
    if (key !== "preview") expect(screen.getByText("Market One")).toBeTruthy();
    view.rerender(page());
    expect(screen.getByRole("textbox", { name: "Variant 1" })).toBeTruthy();
    expect(screen.getByText("Market One")).toBeTruthy();
    expect(screen.getByText("borehole.jpg")).toBeTruthy();
    expect(screen.queryByText(/Service is busy/)).toBeNull();
  });

  it.each(["campaign", "preview", "membership", "writes"] as const)("preserves content and drafts through a failed %s refresh", (key) => {
    const view = render(page()); edit(); addGroup();
    const before = stored();
    const caption = screen.getByRole("textbox", { name: "Variant 1" });
    view.rerender(page({ ...healthy, [key]: failure }));
    expect(screen.getByRole("textbox", { name: "Variant 1" })).toBe(caption);
    expect((caption as HTMLTextAreaElement).value).toBe("Unsaved water caption");
    expect(screen.getByText("New Market")).toBeTruthy();
    expect(screen.getByText("Market One")).toBeTruthy();
    expect(screen.getByText("borehole.jpg")).toBeTruthy();
    expect(stored()).toEqual(before);
    if (key !== "writes") expect(screen.getByText(/Showing out-of-date data/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Apply 1 change" }) as HTMLButtonElement).disabled).toBe(true);
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(save.disabled).toBe(key !== "membership");
    view.rerender(page());
    expect((screen.getByRole("button", { name: "Apply 1 change" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(false);
    expect(stored()).toEqual(before);
    expect((caption as HTMLTextAreaElement).value).toBe("Unsaved water caption");
  });

  it("does not prune stored additions when membership has never loaded", () => {
    localStorage.setItem(groupDraftKey(slug), JSON.stringify({ version: 1, added: ["2@g.us"], removed: [], paused: [] }));
    const view = render(page({ ...healthy, membership: failure }));
    expect(stored().added).toEqual(["2@g.us"]);
    expect(screen.getByText("Draft addition")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add groups" }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(page());
    expect(screen.getByText("New Market")).toBeTruthy();
    expect(stored().added).toEqual(["2@g.us"]);
  });

  it("does not reconcile drafts against a stale preview and fresh membership", () => {
    const view = render(page());
    fireEvent.click(screen.getByRole("button", { name: "Pause Market One in this campaign" }));
    const before = stored();
    view.rerender(page({ ...healthy, preview: failure }));
    expect(stored()).toEqual(before);
    view.rerender(page({ ...healthy, preview: success({ ...preview, groups: [{ ...preview.groups[0], paused: true, sendsToday: false }] }) }));
    expect(localStorage.getItem(groupDraftKey(slug))).toBeNull();
  });

  it("shows an externally applied addition once while membership is unavailable, preserving its draft until recovery", () => {
    const view = render(page()); addGroup();
    const appliedPreview = success({ ...preview, groups: [...preview.groups,
      { ...preview.groups[0], jid: "2@g.us", name: "New Market" }] });
    view.rerender(page({ ...healthy, preview: appliedPreview, membership: failure }));
    expect(screen.getAllByText("New Market")).toHaveLength(1);
    expect(stored().added).toEqual(["2@g.us"]);
    view.rerender(page({ ...healthy, preview: appliedPreview }));
    expect(screen.getAllByText("New Market")).toHaveLength(1);
    expect(localStorage.getItem(groupDraftKey(slug))).toBeNull();
  });

  it("keeps the whole layout when all reads fail, then recovers without clearing edits", () => {
    const down: CampaignDetail = { campaign: failure, preview: failure, membership: failure, writes: failure };
    const view = render(page(down));
    expect(screen.getByRole("heading", { name: "Borehole Drilling" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Where it goes" })).toBeTruthy();
    view.rerender(page()); edit(); addGroup();
    view.rerender(page(down));
    expect(screen.getByText("New Market")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Variant 1" }) as HTMLTextAreaElement).value).toBe("Unsaved water caption");
    view.rerender(page());
    expect((screen.getByRole("textbox", { name: "Variant 1" }) as HTMLTextAreaElement).value).toBe("Unsaved water caption");
  });

  it("manual retry refreshes the page without clearing drafts", async () => {
    const view = render(page()); edit(); addGroup();
    view.rerender(page({ ...healthy, preview: failure }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry campaign preview" })); });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect((screen.getByRole("textbox", { name: "Variant 1" }) as HTMLTextAreaElement).value).toBe("Unsaved water caption");
    expect(stored().added).toEqual(["2@g.us"]);
  });

  it("blocks already-open write confirmations when their dependencies fail", () => {
    const view = render(page()); addGroup();
    fireEvent.click(screen.getByRole("button", { name: "Apply 1 change" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    view.rerender(page({ ...healthy, membership: failure }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.apply).not.toHaveBeenCalled();
    view.rerender(page());
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    view.rerender(page({ ...healthy, campaign: failure }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.switch).not.toHaveBeenCalled();
  });

  it("resets retained data when navigating to another campaign", () => {
    const view = render(page()); edit();
    view.rerender(page({ campaign: failure, preview: failure, membership: failure, writes: failure }, "cv"));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("borehole.jpg")).toBeNull();
    expect(screen.queryByText("Market One")).toBeNull();
  });
});
