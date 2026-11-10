// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaptionVariants } from "@/app/campaigns/_components/caption-variants";

const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/app/campaigns/actions", () => ({ saveCaptionsAction: save }));
const props = {
  slug: "borehole-drilling", captions: ["First {bot_number}", "Second {ref_link}"],
  samples: [{ label: "Market", ref: "BH-123", caption: "First +263123" }, null], writable: true,
};
function mount(overrides = {}) { return render(createElement(CaptionVariants, { ...props, ...overrides })); }
function remove() { fireEvent.click(screen.getByRole("button", { name: "Delete variant 1" })); }
async function saveChanges() { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); }); }
beforeEach(() => { save.mockReset(); save.mockResolvedValue({ ok: true }); });
afterEach(cleanup);

describe("read-only caption cards", () => {
  it("shows template text and group previews with adjacent edit and delete controls", () => {
    mount();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByLabelText("Variant 1").textContent).toBe(props.captions[0]);
    expect(screen.getByText("First +263123")).toBeDefined();
    const edit = screen.getByRole("link", { name: "Edit variant 1" });
    expect(edit.getAttribute("href")).toBe("/campaigns/borehole-drilling/captions/1/edit");
    expect(edit.parentElement).toBe(screen.getByRole("button", { name: "Delete variant 1" }).parentElement);
    expect(screen.getByRole("link", { name: "Add variant" }).getAttribute("href")).toBe("/campaigns/borehole-drilling/captions/new/edit");
  });

  it("stages deletions, renumbers, and saves the surviving original templates", async () => {
    mount(); remove();
    expect(screen.getByLabelText("Variant 1").textContent).toBe(props.captions[1]);
    expect((screen.getByRole("button", { name: "Delete variant 1" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Edit variant 1" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add variant" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Save or reset pending deletions/)).toBeDefined();
    expect(save).not.toHaveBeenCalled();
    await saveChanges();
    expect(save).toHaveBeenCalledWith(props.slug, [props.captions[1]], props.captions);
  });

  it("reset restores deleted variants and editor navigation", () => {
    mount(); remove(); fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByLabelText("Variant 1").textContent).toBe(props.captions[0]);
    expect(screen.getByRole("link", { name: "Edit variant 1" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Add variant" })).toBeDefined();
  });

  it("keeps deletion drafts through refreshes, blocks conflicts, and resets to latest", () => {
    const view = mount(); remove();
    view.rerender(createElement(CaptionVariants, { ...props, captions: [...props.captions] }));
    expect(screen.getByLabelText("Variant 1").textContent).toBe(props.captions[1]);
    view.rerender(createElement(CaptionVariants, { ...props, captions: ["Changed elsewhere"] }));
    expect(screen.getByRole("alert").textContent).toContain("changed while");
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByLabelText("Variant 1").textContent).toBe("Changed elsewhere");
  });

  it("retains failed deletions and allows a retry", async () => {
    save.mockResolvedValueOnce({ ok: false, detail: "The write service is busy" });
    mount(); remove(); await saveChanges();
    expect(screen.getByRole("alert").textContent).toBe("The write service is busy");
    expect(screen.getByLabelText("Variant 1").textContent).toBe(props.captions[1]);
    await saveChanges();
    expect(screen.getByRole("status").textContent).toBe("Captions saved.");
  });

  it("keeps navigation blocked when an external change matches the staged deletion", () => {
    const view = mount(); remove();
    view.rerender(createElement(CaptionVariants, { ...props, captions: [props.captions[1]] }));
    expect(screen.getByRole("alert").textContent).toContain("changed while");
    expect((screen.getByRole("button", { name: "Edit variant 1" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("link", { name: "Edit variant 1" })).toBeDefined();
  });

  it("locks controls during saving and retains the draft on transport errors", async () => {
    let fail!: (error: Error) => void;
    save.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    mount(); remove(); await saveChanges();
    expect((screen.getByRole("button", { name: "Reset" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => fail(new Error("network")));
    expect(screen.getByRole("alert").textContent).toContain("Your edits are still here");
  });

  it("shows fresh captions when there is no draft", () => {
    const view = mount();
    view.rerender(createElement(CaptionVariants, { ...props, captions: ["Latest"] }));
    expect(screen.getByLabelText("Variant 1").textContent).toBe("Latest");
  });

  it("preserves read-only mode with rendered previews and no write controls", () => {
    mount({ writable: false });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("link", { name: "Add variant" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Edit variant 1" })).toBeNull();
    expect(screen.getByText("First +263123")).toBeDefined();
  });

  it("allows draft navigation but blocks saves when the bot is unavailable", () => {
    mount({ saveUnavailableReason: "Saving is not connected to the bot yet." });
    expect(screen.getByRole("link", { name: "Edit variant 1" })).toBeDefined();
    remove();
    expect(screen.getByText(/Saving is not connected/)).toBeDefined();
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});
