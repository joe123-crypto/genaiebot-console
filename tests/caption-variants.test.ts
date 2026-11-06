// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaptionVariants } from "@/app/campaigns/_components/caption-variants";

const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/app/campaigns/actions", () => ({ saveCaptionsAction: save }));

const props = {
  slug: "borehole-drilling", captions: ["First {bot_number}", "Second {ref_link}"],
  samples: [{ label: "Market", ref: "BH-123", caption: "First +263123" }, null],
  writable: true,
};
function mount(overrides = {}) {
  return render(createElement(CaptionVariants, { ...props, ...overrides }));
}
function edit(value = "Edited {bot_number}\n\nKeep line breaks 💧") {
  fireEvent.change(screen.getByRole("textbox", { name: "Variant 1" }), { target: { value } });
}
async function saveChanges() {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); });
}
beforeEach(() => { save.mockReset(); save.mockResolvedValue({ ok: true }); });
afterEach(cleanup);

describe("caption editor", () => {
  it("edits the template rather than the rendered group copy", () => {
    mount();
    expect((screen.getByRole("textbox", { name: "Variant 1" }) as HTMLTextAreaElement).value).toBe("First {bot_number}");
    expect(screen.getByText("First +263123")).toBeDefined();
  });

  it("adds with plus, focuses the new caption, and saves all changes together", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Add variant" }));
    const added = screen.getByRole("textbox", { name: "Variant 3" });
    expect(document.activeElement).toBe(added);
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(added, { target: { value: "New 💧\n\n{ref_link}" } });
    await saveChanges();
    expect(save).toHaveBeenCalledWith(props.slug, [...props.captions, "New 💧\n\n{ref_link}"], props.captions);
  });

  it("deletes by trash and keeps the surviving text while renumbering", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Delete variant 1" }));
    expect((screen.getByRole("textbox", { name: "Variant 1" }) as HTMLTextAreaElement).value).toBe(props.captions[1]);
    expect((screen.getByRole("button", { name: "Delete variant 1" }) as HTMLButtonElement).disabled).toBe(true);
    await saveChanges();
    expect(save).toHaveBeenCalledWith(props.slug, [props.captions[1]], props.captions);
  });

  it("retains unsaved typing across automatic refreshes and resets to current data", () => {
    const view = mount();
    edit();
    view.rerender(createElement(CaptionVariants, { ...props, captions: [...props.captions] }));
    expect((screen.getByRole("textbox", { name: "Variant 1" }) as HTMLTextAreaElement).value).toContain("Edited");
    view.rerender(createElement(CaptionVariants, { ...props, captions: ["Changed elsewhere"] }));
    expect(screen.getByRole("alert").textContent).toContain("changed while");
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect((screen.getByRole("textbox", { name: "Variant 1" }) as HTMLTextAreaElement).value).toBe("Changed elsewhere");
  });

  it("shows failures without losing the draft and allows a retry", async () => {
    save.mockResolvedValueOnce({ ok: false, detail: "The write service is busy" });
    mount();
    edit();
    await saveChanges();
    expect(screen.getByRole("alert").textContent).toBe("The write service is busy");
    expect((screen.getByRole("textbox", { name: "Variant 1" }) as HTMLTextAreaElement).value).toContain("Edited");
    await saveChanges();
    expect(screen.getByRole("status").textContent).toBe("Captions saved.");
  });

  it("locks controls during a save and handles transport failures", async () => {
    let fail!: (error: Error) => void;
    save.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    mount(); edit();
    await saveChanges();
    expect((screen.getByRole("button", { name: "Add variant" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("textbox", { name: "Variant 1" }) as HTMLTextAreaElement).disabled).toBe(true);
    await act(async () => fail(new Error("network")));
    expect(screen.getByRole("alert").textContent).toContain("Your edits are still here");
  });

  it("shows updated server captions when no draft is in progress", () => {
    const view = mount();
    view.rerender(createElement(CaptionVariants, { ...props, captions: ["Latest"] }));
    expect((screen.getByRole("textbox", { name: "Variant 1" }) as HTMLTextAreaElement).value).toBe("Latest");
  });

  it("preserves read-only previews without editing controls", () => {
    mount({ writable: false });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add variant" })).toBeNull();
    expect(screen.getByText("First +263123")).toBeDefined();
  });

  it("allows drafting but explains when saving has no bot connection", () => {
    mount({ saveUnavailableReason: "Saving is not connected to the bot yet. You can edit a draft here." });
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Add variant" }));
    expect(screen.getByRole("textbox", { name: "Variant 3" })).toBeDefined();
    expect(screen.getByText(/Saving is not connected/)).toBeDefined();
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});
