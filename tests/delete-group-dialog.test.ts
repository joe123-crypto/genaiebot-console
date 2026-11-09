// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { remove } = vi.hoisted(() => ({ remove: vi.fn() }));
const onIncomplete = vi.fn();
vi.mock("@/app/groups/actions", () => ({ deleteGroupAction: remove }));

import {
  CLEAR_LABEL, DeleteGroup, LEAVE_LABEL,
} from "@/app/groups/_components/delete-group";

/**
 * The dialog's job beyond confirming: it must never ask for something the bot
 * will refuse, must default to the plain delete, and must be the place a
 * half-done delete gets reported -- the row disappears the moment it succeeds,
 * taking any other chance to say so with it.
 */
function mount(props: Partial<Parameters<typeof DeleteGroup>[0]> = {}) {
  return render(createElement(DeleteGroup, {
    jid: "120363111@g.us", label: "Harare Market", account: "ads",
    onIncomplete,
    gate: { allowed: true }, leaveGate: { allowed: true }, clearGate: { allowed: true },
    ...props,
  }));
}

function open() {
  fireEvent.click(screen.getByRole("button", { name: "Delete Harare Market" }));
}

function confirm() {
  fireEvent.change(screen.getByLabelText(/Type/), { target: { value: "Harare Market" } });
}

const box = (label: string) =>
  screen.getByRole("checkbox", { name: new RegExp(label.slice(0, 24)) }) as HTMLInputElement;

afterEach(() => {
  cleanup();
  remove.mockReset();
  onIncomplete.mockReset();
  remove.mockResolvedValue({ ok: true });
});

describe("the delete dialog's optional halves", () => {
  it("offers both, unticked, so a plain delete stays the default", () => {
    mount();
    open();
    expect(box(LEAVE_LABEL).checked).toBe(false);
    expect(box(CLEAR_LABEL).checked).toBe(false);
  });

  it("asks for nothing beyond the record when neither is ticked", async () => {
    mount();
    open();
    confirm();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete group" }));
    });
    expect(remove).toHaveBeenCalledWith("120363111@g.us", {
      reason: "", leave: false, clearRecords: false, account: "ads",
    });
  });

  it("sends what was ticked, with the line the row knew", async () => {
    mount();
    open();
    fireEvent.click(box(LEAVE_LABEL));
    fireEvent.click(box(CLEAR_LABEL));
    confirm();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete group" }));
    });
    expect(remove).toHaveBeenCalledWith("120363111@g.us", {
      reason: "", leave: true, clearRecords: true, account: "ads",
    });
  });

  it("disables an action the bot will not do, and says why", () => {
    mount({ leaveGate: { allowed: false, reason: "This bot cannot leave groups yet." } });
    open();
    expect(box(LEAVE_LABEL).disabled).toBe(true);
    expect(screen.getByText("This bot cannot leave groups yet.")).toBeTruthy();
    expect(box(CLEAR_LABEL).disabled).toBe(false);
  });

  it("cannot ask for a disabled action even if its state was set", async () => {
    const { rerender } = mount();
    open();
    fireEvent.click(box(LEAVE_LABEL));
    expect(box(LEAVE_LABEL).checked).toBe(true);

    // The bot's answer changed under the open dialog, as a refresh can do.
    rerender(createElement(DeleteGroup, {
      jid: "120363111@g.us", label: "Harare Market", account: "ads", onIncomplete,
      gate: { allowed: true }, clearGate: { allowed: true },
      leaveGate: { allowed: false, reason: "Group actions are switched off." },
    }));
    confirm();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete group" }));
    });
    expect(remove).toHaveBeenCalledWith("120363111@g.us",
      expect.objectContaining({ leave: false }));
  });

  it("hands a half-done delete upward rather than showing it in the doomed row", async () => {
    const warnings = ["The bot could not leave the WhatsApp group, so its number is still in it."];
    remove.mockResolvedValue({ ok: true, warnings });
    mount();
    open();
    fireEvent.click(box(LEAVE_LABEL));
    confirm();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete group" }));
    });

    // Reported to the owner of the table, which outlives this row, and the
    // dialog closes rather than waiting to be unmounted mid-sentence.
    expect(onIncomplete).toHaveBeenCalledWith("Harare Market", warnings);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes without a word when everything asked for came off", async () => {
    mount();
    open();
    fireEvent.click(box(CLEAR_LABEL));
    confirm();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete group" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onIncomplete).not.toHaveBeenCalled();
  });

  it("forgets the ticks when reopened, so a delete cannot inherit the last one", async () => {
    mount();
    open();
    fireEvent.click(box(LEAVE_LABEL));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    open();
    expect(box(LEAVE_LABEL).checked).toBe(false);
  });

  it("keeps the dialog on a refusal, with the bot's reasons", async () => {
    remove.mockResolvedValue({ ok: false, detail: "no such group", problems: ["gone"] });
    mount();
    open();
    confirm();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete group" }));
    });
    expect(screen.getByText("no such group")).toBeTruthy();
    expect(screen.getByText("gone")).toBeTruthy();
  });
});
