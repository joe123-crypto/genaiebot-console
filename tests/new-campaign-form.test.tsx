// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewCampaignForm } from "@/app/campaigns/_components/new-campaign-form";
import { CAMPAIGN_DRAFT_KEY } from "@/src/lib/campaign-draft";
const mock = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), keep: vi.fn(), files: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push, refresh: mock.refresh }) }));
vi.mock("@/src/lib/campaign-files", () => ({ keepDraftFiles: mock.keep, draftFiles: mock.files, forgetDraftFiles: vi.fn() }));
const groups = [{ jid: "1@g.us", name: "Market One", account: "default", status: "active" as const },
  { jid: "2@g.us", name: "Market Two", account: "ads", status: "active" as const },
  { jid: "3@g.us", name: "Paused", account: "ads", status: "on-hold" as const }];
const props = { groups, gate: { allowed: true as const } };
const sha = "a".repeat(64);
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.stubGlobal("crypto", { randomUUID: () => "12345678-1234-1234-1234-123456789abc", subtle: { digest: async () => new Uint8Array(32).buffer } });
  URL.createObjectURL = vi.fn(() => "blob:preview"); URL.revokeObjectURL = vi.fn();
  vi.stubGlobal("fetch", vi.fn());
  mock.files.mockResolvedValue(new Map());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function fill() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sale" } });
  fireEvent.change(screen.getByLabelText("Posting time"), { target: { value: "10:00" } });
  fireEvent.click(screen.getByLabelText(/Market One/)); fireEvent.click(screen.getByLabelText(/Market Two/));
  const file = new File([new Uint8Array([1, 2, 3])], "sale.png", { type: "image/png" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([1, 2, 3]).buffer });
  fireEvent.change(screen.getByLabelText("Add pictures"), { target: { files: [file] } });
}
function stashed() {
  return JSON.parse(sessionStorage.getItem(CAMPAIGN_DRAFT_KEY)!);
}
describe("new campaign form", () => {
  it("keeps advanced settings optional and collapsed, and starts disabled", () => {
    const view = render(<NewCampaignForm {...props} />);
    expect(view.container.querySelector("details")?.open).toBe(false);
    expect((screen.getByLabelText("Enabled") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText(/Paused/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByLabelText("Line")).toBeNull();
  });
  it("asks for no captions and continues to the caption step instead of creating", async () => {
    const view = render(<NewCampaignForm {...props} />);
    expect(screen.queryByLabelText("Caption 1")).toBeNull();
    expect(screen.queryByRole("button", { name: "Create campaign" })).toBeNull();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(mock.push).toHaveBeenCalledWith("/campaigns/new/caption"));
    expect(stashed().draft).toMatchObject({ enabled: false, name: "Sale", slug: "sale",
      schedule: { time: "10:00", timezone: "Africa/Harare" }, groups: [{ jid: "1@g.us" }, { jid: "2@g.us" }] });
    expect(stashed().draft.captions).toBeUndefined();
    expect(stashed().draft.tracking).toBeUndefined();
    expect(stashed().groupNames).toEqual({ "1@g.us": "Market One", "2@g.us": "Market Two" });
    // Nothing is sent from this step: the pictures are only kept locally.
    expect(fetch).not.toHaveBeenCalled();
    expect([...mock.keep.mock.calls[0][0].keys()]).toEqual([stashed().draft.images[0].key]);
    expect(view.container.querySelector("fieldset")!.disabled).toBe(false);
  });
  it("refuses incomplete details without uploading or stashing", async () => {
    render(<NewCampaignForm {...props} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sale" } });
    fireEvent.change(screen.getByLabelText("Posting time"), { target: { value: "10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Choose between 1 and 20 pictures.");
    expect(sessionStorage.getItem(CAMPAIGN_DRAFT_KEY)).toBeNull();
    expect(mock.push).not.toHaveBeenCalled();
  });
  it("keeps the draft on failed refresh and still prepares the details", () => {
    const view = render(<NewCampaignForm {...props} />); fill();
    view.rerender(<NewCampaignForm groups={[]} gate={{ allowed: false, reason: "Unavailable" }} loadError="Busy gateway" />);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Sale");
    expect((screen.getByLabelText(/Market One/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByAltText("Picture 1: sale.png")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("keeps fields when the pictures cannot be kept and carries nothing forward", async () => {
    mock.keep.mockRejectedValueOnce(new Error("Pictures could not be kept"));
    const view = render(<NewCampaignForm {...props} />); fill();
    fireEvent.submit(view.container.querySelector("form")!);
    await screen.findByText("Pictures could not be kept");
    expect(sessionStorage.getItem(CAMPAIGN_DRAFT_KEY)).toBeNull();
    expect(mock.push).not.toHaveBeenCalled();
    expect(view.container.querySelector("fieldset")!.disabled).toBe(false);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Sale");
  });
  it("refills every detail when the operator steps back from the captions", async () => {
    sessionStorage.setItem(CAMPAIGN_DRAFT_KEY, JSON.stringify({ version: 1, groupNames: { "1@g.us": "Market One" }, draft: {
      requestId: "12345678-1234-1234-1234-123456789abc", slug: "sale", name: "Sale", enabled: true,
      images: [{ filename: "sale.png", key: `ads/sale/${sha}.png`, sha256: sha, bytes: 3, contentType: "image/png" }],
      schedule: { time: "10:00", timezone: "Africa/Harare", weekdays: [0, 1, 2, 3, 4, 5, 6] },
      groups: [{ jid: "1@g.us" }], comment: "Kept note" } }));
    const kept = new File([new Uint8Array([1, 2, 3])], "sale.png", { type: "image/png" });
    mock.files.mockResolvedValue(new Map([[`ads/sale/${sha}.png`, kept]]));
    render(<NewCampaignForm {...props} paginated />);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Sale");
    expect((screen.getByLabelText("Enabled") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Posting time") as HTMLInputElement).value).toBe("10:00");
    expect((screen.getByLabelText("Campaign note") as HTMLTextAreaElement).value).toBe("Kept note");
    expect(screen.getByRole("button", { name: "Remove Market One" })).toBeTruthy();
    await waitFor(() => expect(screen.getByAltText("Picture 1: sale.png")).toBeTruthy());
  });
  it("ignores a stash it cannot trust", () => {
    sessionStorage.setItem(CAMPAIGN_DRAFT_KEY, JSON.stringify({ version: 1, draft: { name: "Half a campaign" } }));
    render(<NewCampaignForm {...props} />);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
  });
});
