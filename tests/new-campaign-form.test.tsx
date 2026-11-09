// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewCampaignForm } from "@/app/campaigns/_components/new-campaign-form";
const mock = vi.hoisted(() => ({ save: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/campaigns/new/actions", () => ({ createCampaignAction: mock.save }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push, refresh: mock.refresh }) }));
const groups = [{ jid: "1@g.us", name: "Market One", account: "default", status: "active" as const },
  { jid: "2@g.us", name: "Market Two", account: "ads", status: "active" as const },
  { jid: "3@g.us", name: "Paused", account: "ads", status: "on-hold" as const }];
const props = { groups, gate: { allowed: true as const } };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", { randomUUID: () => "12345678-1234-1234-1234-123456789abc", subtle: { digest: async () => new Uint8Array(32).buffer } });
  URL.createObjectURL = vi.fn(() => "blob:preview"); URL.revokeObjectURL = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://r2.example/put", headers: {} }) }).mockResolvedValue({ ok: true }));
  mock.save.mockResolvedValue({ ok: true, slug: "sale", scheduling: "ready" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function fill() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sale" } });
  fireEvent.change(screen.getByLabelText("Caption 1"), { target: { value: "Our latest sale" } });
  fireEvent.change(screen.getByLabelText("Posting time"), { target: { value: "10:00" } });
  fireEvent.click(screen.getByLabelText(/Market One/)); fireEvent.click(screen.getByLabelText(/Market Two/));
  const file = new File([new Uint8Array([1, 2, 3])], "sale.png", { type: "image/png" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([1, 2, 3]).buffer });
  fireEvent.change(screen.getByLabelText("Add pictures"), { target: { files: [file] } });
}
describe("new campaign form", () => {
  it("keeps advanced settings optional and collapsed, and starts disabled", () => {
    const view = render(<NewCampaignForm {...props} />);
    expect(view.container.querySelector("details")?.open).toBe(false);
    expect((screen.getByLabelText("Enabled") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText(/Paused/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByLabelText("Line")).toBeNull();
  });
  it("creates across two lines without touching optional settings", async () => {
    const view = render(<NewCampaignForm {...props} />); fill();
    fireEvent.submit(view.container.querySelector("form")!);
    await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(1));
    expect(mock.save.mock.calls[0][0]).toMatchObject({ enabled: false, name: "Sale", schedule: { time: "10:00", timezone: "Africa/Harare" }, groups: [{ jid: "1@g.us" }, { jid: "2@g.us" }] });
    expect(mock.save.mock.calls[0][0].tracking).toBeUndefined();
    await waitFor(() => expect(mock.push).toHaveBeenCalledWith("/campaigns/sale"));
  });
  it("keeps the draft on failed refresh and disables saving", () => {
    const view = render(<NewCampaignForm {...props} />); fill();
    view.rerender(<NewCampaignForm groups={[]} gate={{ allowed: false, reason: "Unavailable" }} loadError="Busy gateway" />);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Sale");
    expect((screen.getByLabelText(/Market One/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("button", { name: "Create campaign" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByAltText("Picture 1: sale.png")).toBeTruthy();
  });
  it("locks edits and retries the complete original payload after an unknown outcome", async () => {
    mock.save.mockResolvedValueOnce({ ok: false, detail: "Outcome unknown; retry this request", outcome: "unknown" });
    const view = render(<NewCampaignForm {...props} />); fill();
    fireEvent.submit(view.container.querySelector("form")!);
    await screen.findByText("Outcome unknown; retry this request");
    const original = structuredClone(mock.save.mock.calls[0][0]);
    expect(view.container.querySelector("fieldset")!.disabled).toBe(true);
    expect(screen.getByRole("link", { name: "Check campaign" }).getAttribute("href")).toBe("/campaigns/sale");
    // Even programmatic changes to disabled controls cannot change recovery.
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Changed sale" } });
    fireEvent.change(screen.getByLabelText("Caption 1"), { target: { value: "Different caption" } });
    fireEvent.change(screen.getByLabelText("Posting time"), { target: { value: "11:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Retry original request" }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2));
    expect(mock.save.mock.calls[1][0]).toEqual(original);
    expect(fetch).toHaveBeenCalledTimes(2); // One signing request and one PUT.
  });
  it("retains recovery across refreshes and later preflight refusals", async () => {
    mock.save.mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce({ ok: false, detail: "Read-only now", outcome: "not-created" });
    const view = render(<NewCampaignForm {...props} />); fill();
    fireEvent.submit(view.container.querySelector("form")!);
    await screen.findByText("Connection lost");
    const original = structuredClone(mock.save.mock.calls[0][0]);
    view.rerender(<NewCampaignForm {...props} groups={[groups[0]]} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry original request" }));
    await screen.findByText("Read-only now");
    expect(view.container.querySelector("fieldset")!.disabled).toBe(true);
    expect(screen.getByRole("link", { name: "Check campaign" }).getAttribute("href")).toBe("/campaigns/sale");
    fireEvent.click(screen.getByRole("button", { name: "Retry original request" }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(3));
    expect(mock.save.mock.calls[1][0]).toEqual(original);
    expect(mock.save.mock.calls[2][0]).toEqual(original);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("allows correction after a definite refusal of the first creation attempt", async () => {
    mock.save.mockResolvedValueOnce({ ok: false, detail: "Invalid caption", outcome: "not-created" });
    const view = render(<NewCampaignForm {...props} />); fill();
    fireEvent.submit(view.container.querySelector("form")!);
    await screen.findByText("Invalid caption");
    expect(view.container.querySelector("fieldset")!.disabled).toBe(false);
    expect(screen.queryByRole("link", { name: "Check campaign" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Caption 1"), { target: { value: "Corrected caption" } });
    fireEvent.click(screen.getByRole("button", { name: "Create campaign" }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2));
    expect(mock.save.mock.calls[1][0].captions).toEqual(["Corrected caption"]);
  });
  it("ends unknown-outcome recovery when the saved schedule is confirmed pending", async () => {
    mock.save.mockResolvedValueOnce({ ok: false, detail: "Lost response", outcome: "unknown" })
      .mockResolvedValueOnce({ ok: true, slug: "sale", scheduling: "pending", warning: "Schedule pending" });
    const view = render(<NewCampaignForm {...props} />); fill();
    fireEvent.submit(view.container.querySelector("form")!);
    await screen.findByText("Lost response");
    fireEvent.click(screen.getByRole("button", { name: "Retry original request" }));
    await screen.findByText("Schedule pending");
    expect(screen.queryByRole("link", { name: "Check campaign" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open saved campaign" }).getAttribute("href")).toBe("/campaigns/sale");
    expect(view.container.querySelector("fieldset")!.disabled).toBe(true);
  });
  it("reports a saved pending campaign without submitting it again", async () => {
    mock.save.mockResolvedValue({ ok: true, slug: "sale", scheduling: "pending", warning: "Scheduling will retry" });
    const view = render(<NewCampaignForm {...props} />); fill();
    fireEvent.submit(view.container.querySelector("form")!);
    await screen.findByText("Scheduling will retry");
    expect(screen.getByRole("link", { name: "Open saved campaign" }).getAttribute("href")).toBe("/campaigns/sale");
    expect((screen.getByRole("button", { name: "Create campaign" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("keeps fields when an upload fails and never creates the campaign", async () => {
    vi.mocked(fetch).mockReset().mockResolvedValue({ ok: false, json: async () => ({ error: "Upload unavailable" }) } as Response);
    const view = render(<NewCampaignForm {...props} />); fill();
    fireEvent.submit(view.container.querySelector("form")!);
    await screen.findByText("Upload unavailable");
    expect(mock.save).not.toHaveBeenCalled();
    expect(view.container.querySelector("fieldset")!.disabled).toBe(false);
    expect(screen.queryByRole("link", { name: "Check campaign" })).toBeNull();
    expect((screen.getByLabelText("Caption 1") as HTMLTextAreaElement).value).toBe("Our latest sale");
  });
});
