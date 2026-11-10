// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { setEnabled, removeCampaign } = vi.hoisted(() => ({ setEnabled: vi.fn(), removeCampaign: vi.fn() }));
vi.mock("@/app/campaigns/actions", () => ({ setCampaignEnabledAction: setEnabled, deleteCampaignAction: removeCampaign }));

import { CampaignRowActions } from "@/app/campaigns/_components/campaign-row-actions";
import { NO_CRON_NOTE } from "@/app/campaigns/_components/campaign-switch";

function mount(props: Partial<Parameters<typeof CampaignRowActions>[0]> = {}) {
  return render(createElement(CampaignRowActions, {
    slug: "borehole", title: "Borehole", storeEnabled: true, cronEnabled: true,
    gate: { allowed: true }, deleteGate: { allowed: false, reason: "Deletion unavailable" }, ...props,
  }));
}

const deleteButton = () =>
  screen.getByRole("button", { name: "Delete Borehole" }) as HTMLButtonElement;

afterEach(() => { cleanup(); setEnabled.mockReset(); removeCampaign.mockReset(); });

describe("CampaignRowActions", () => {
  it("asks before turning a campaign off, then switches it", async () => {
    setEnabled.mockResolvedValue({ ok: true });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Turn off Borehole" }));
    const dialog = screen.getByRole("alertdialog", { name: "Turn off Borehole?" });
    expect(dialog.textContent).toMatch(/stops posting from its next run/);
    expect(setEnabled).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Turn off" }));
    });
    expect(setEnabled).toHaveBeenCalledWith("borehole", false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("turns a switched-off campaign back on", async () => {
    setEnabled.mockResolvedValue({ ok: true });
    mount({ storeEnabled: false });
    fireEvent.click(screen.getByRole("button", { name: "Turn on Borehole" }));
    const dialog = screen.getByRole("alertdialog", { name: "Turn on Borehole?" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Turn on" }));
    });
    expect(setEnabled).toHaveBeenCalledWith("borehole", true);
  });

  it("keeps the question it asked when a refresh changes the switch underneath", async () => {
    // The sixty-second refresh lands while "Turn off?" is on screen.
    setEnabled.mockResolvedValue({ ok: true });
    const view = mount();
    fireEvent.click(screen.getByRole("button", { name: "Turn off Borehole" }));
    view.rerender(createElement(CampaignRowActions, {
      slug: "borehole", title: "Borehole", storeEnabled: false, cronEnabled: true,
      gate: { allowed: true }, deleteGate: { allowed: false, reason: "Deletion unavailable" },
    }));
    const dialog = screen.getByRole("alertdialog", { name: "Turn off Borehole?" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Turn off" }));
    });
    expect(setEnabled).toHaveBeenCalledWith("borehole", false);
  });

  it("does nothing when the question is cancelled", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Turn off Borehole" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(setEnabled).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("keeps the question open on the bot's reasons when it refuses", async () => {
    setEnabled.mockResolvedValue({
      ok: false, detail: "refused", problems: ["enabled must be true or false"],
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Turn off Borehole" }));
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Turn off" }).at(-1)!);
    });
    expect(screen.getByRole("alert").textContent).toMatch(/enabled must be true or false/);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("warns in the dialog that no cron will fire for this campaign", () => {
    mount({ storeEnabled: false, cronEnabled: false });
    fireEvent.click(screen.getByRole("button", { name: "Turn on Borehole" }));
    expect(screen.getByRole("alertdialog").textContent).toContain(NO_CRON_NOTE);
  });

  it("disables the switch, saying why, when the bot will not take the change", () => {
    mount({ gate: { allowed: false, reason: "The bot does not accept changes to enabled yet." } });
    const button = screen.getByRole("button", { name: "Turn off Borehole" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/does not accept changes to enabled/);
    fireEvent.click(button);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows a delete that is switched off and says why, never a dialog", () => {
    mount();
    expect(deleteButton().disabled).toBe(true);
    expect(deleteButton().title).toBe("Deletion unavailable");
    fireEvent.click(deleteButton());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(setEnabled).not.toHaveBeenCalled();
  });

  it("carries whatever reason it was given", () => {
    mount({ deleteGate: { allowed: false, reason: "The bot does not delete campaigns." } });
    expect(deleteButton().title).toBe("The bot does not delete campaigns.");
  });
});

describe("campaign deletion", () => {
  const open = () => {
    fireEvent.click(deleteButton());
    return screen.getByRole("alertdialog", { name: "Delete Borehole?" });
  };
  it("confirms deletion, calls the action, and clears only this campaign's draft", async () => {
    removeCampaign.mockResolvedValue({ ok: true });
    localStorage.setItem("genaie:campaign-groups:v1:borehole", "draft");
    localStorage.setItem("genaie:campaign-groups:v1:cv", "keep");
    mount({ deleteGate: { allowed: true } });
    const dialog = open();
    expect(dialog.textContent).toContain("pictures used only by this campaign");
    expect(removeCampaign).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Delete campaign" })); });
    expect(removeCampaign).toHaveBeenCalledWith("borehole");
    expect(localStorage.getItem("genaie:campaign-groups:v1:borehole")).toBeNull();
    expect(localStorage.getItem("genaie:campaign-groups:v1:cv")).toBe("keep");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
  it("cancels without writing", () => {
    mount({ deleteGate: { allowed: true } }); open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(removeCampaign).not.toHaveBeenCalled();
  });
  it("retains the dialog and draft when the outcome is unknown", async () => {
    removeCampaign.mockResolvedValue({ ok: false, detail: "Timed out; the campaign may have been deleted", problems: ["Refresh before retrying"] });
    localStorage.setItem("genaie:campaign-groups:v1:borehole", "keep");
    mount({ deleteGate: { allowed: true } }); const dialog = open();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Delete campaign" })); });
    expect(screen.getByRole("alert").textContent).toContain("may have been deleted");
    expect(localStorage.getItem("genaie:campaign-groups:v1:borehole")).toBe("keep");
  });
  it("prevents duplicate submissions and switching while pending", async () => {
    let resolve!: (value: { ok: true }) => void;
    removeCampaign.mockReturnValue(new Promise((done) => { resolve = done; }));
    mount({ deleteGate: { allowed: true } }); const dialog = open();
    const confirm = within(dialog).getByRole("button", { name: "Delete campaign" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(removeCampaign).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Turn off Borehole" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { resolve({ ok: true }); });
  });
  it("closes the dialog when delete permission is revoked on refresh", () => {
    const view = mount({ deleteGate: { allowed: true } }); open();
    view.rerender(createElement(CampaignRowActions, { slug: "borehole", title: "Borehole", storeEnabled: true,
      gate: { allowed: true }, deleteGate: { allowed: false, reason: "Read only" } }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(deleteButton().disabled).toBe(true);
  });
});

it("keeps the deletion dialog open if the server action connection fails", async () => {
  removeCampaign.mockRejectedValue(new Error("Connection lost"));
  mount({ deleteGate: { allowed: true } });
  fireEvent.click(deleteButton());
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete campaign" })); });
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("may have been deleted");
});
