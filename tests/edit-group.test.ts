// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Group } from "@/src/lib/types";

const { update } = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/app/groups/actions", () => ({ updateGroupAction: update }));

import { EditGroup, touchedFields } from "@/app/groups/_components/edit-group";

const ALL = ["name", "status", "activity", "account", "daily_cap", "note"];

function group(overrides: Partial<Group> = {}): Group {
  return {
    jid: "120363111@g.us", name: "Harare Market", source: "operator", status: "active",
    activity: "normal", account: "default", dailyCapOverride: null, promos: [],
    weekly: {}, note: null, cap: 4, replyScore: null, allowedToday: [],
    ...overrides,
  };
}

function mount(props: Partial<Parameters<typeof EditGroup>[0]> = {}) {
  return render(createElement(EditGroup, {
    group: group(), label: "Harare Market", lines: ["default", "ads"],
    tiers: ["busy", "normal", "quiet"], gate: { allowed: true }, editable: ALL,
    ...props,
  }));
}

afterEach(() => {
  cleanup();
  update.mockReset();
});

describe("touchedFields", () => {
  it("sends only what the operator changed, with what it showed before", () => {
    const g = group({ dailyCapOverride: 3 });
    const draft = { name: "Harare Market", status: "on-hold", activity: "normal",
                    account: "default", daily_cap: "3", note: "" };
    expect(touchedFields(g, draft)).toEqual({
      form: { status: "on-hold" },
      expected: { status: "active" },
    });
  });

  it("sends the bot's own value as expected, not the form's text", () => {
    // A cap shows as "3" in the box but is the number 3 to the bot; a stale check
    // comparing text with numbers would refuse every cap edit.
    const g = group({ dailyCapOverride: 3 });
    const draft = { name: "Harare Market", status: "active", activity: "normal",
                    account: "default", daily_cap: "5", note: "" };
    expect(touchedFields(g, draft).expected).toEqual({ daily_cap: 3 });
  });
});

describe("EditGroup", () => {
  it("is disabled, saying why, when the bot will not take edits", () => {
    mount({ gate: { allowed: false, reason: "The bot has no write key installed, so it cannot save changes yet." } });
    const button = screen.getByRole("button", { name: "Edit Harare Market" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/no write key/);
  });

  it("saves only the changed field", async () => {
    update.mockResolvedValue({ ok: true });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Edit Harare Market" }));
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "on-hold" } });
    expect(save.disabled).toBe(false);
    await act(async () => fireEvent.click(save));
    expect(update).toHaveBeenCalledWith("120363111@g.us", { status: "on-hold" }, { status: "active" });
  });

  it("disables a field the bot does not accept, and says so", () => {
    mount({ editable: ["status"] });
    fireEvent.click(screen.getByRole("button", { name: "Edit Harare Market" }));
    expect((screen.getByLabelText("Status") as HTMLSelectElement).disabled).toBe(false);
    const note = screen.getByLabelText("Note") as HTMLTextAreaElement;
    expect(note.disabled).toBe(true);
    expect(note.closest(".form-field")?.getAttribute("title")).toMatch(/does not accept changes to note/);
  });

  it("shows the bot's reasons when it refuses, and keeps the dialog open", async () => {
    update.mockResolvedValue({ ok: false, detail: "this change would stop it being advertised to",
                               problems: ["group x: unknown account 'sales'"] });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Edit Harare Market" }));
    fireEvent.change(screen.getByLabelText("Tier"), { target: { value: "busy" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save changes" })));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/would stop it being advertised to/);
    expect(alert.textContent).toMatch(/unknown account 'sales'/);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("warns when a save would not reach the campaigns", () => {
    mount({ gate: { allowed: true, warning: "Saved changes go to Firestore, but the campaigns still read membership.json" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit Harare Market" }));
    expect(screen.getByText(/campaigns still read membership.json/)).toBeTruthy();
  });

  it("says when a change takes effect", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Edit Harare Market" }));
    expect(screen.getByText(/next run/)).toBeTruthy();
  });
});
