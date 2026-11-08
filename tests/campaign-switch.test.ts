// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { setEnabled } = vi.hoisted(() => ({ setEnabled: vi.fn() }));
vi.mock("@/app/campaigns/actions", () => ({ setCampaignEnabledAction: setEnabled }));

import { CampaignSwitch, NO_CRON_NOTE } from "@/app/campaigns/_components/campaign-switch";
import { campaignOffLabel } from "@/src/lib/format";

function mount(props: Partial<Parameters<typeof CampaignSwitch>[0]> = {}) {
  return render(createElement(CampaignSwitch, {
    slug: "borehole", title: "Borehole", storeEnabled: true, cronEnabled: true,
    gate: { allowed: true }, ...props,
  }));
}

afterEach(() => { cleanup(); setEnabled.mockReset(); });

describe("CampaignSwitch", () => {
  it("asks before turning a campaign off, then switches it", async () => {
    setEnabled.mockResolvedValue({ ok: true });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    const dialog = screen.getByRole("alertdialog", { name: "Turn off Borehole?" });
    expect(dialog.textContent).toMatch(/stops posting from its next run/);
    expect(setEnabled).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Turn off" }).at(-1)!);
    });
    expect(setEnabled).toHaveBeenCalledWith("borehole", false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("keeps the question it asked when a refresh changes the switch underneath", async () => {
    // Another tab turns the campaign off while this one asks "Turn off?".
    setEnabled.mockResolvedValue({ ok: true });
    const view = mount();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    view.rerender(createElement(CampaignSwitch, {
      slug: "borehole", title: "Borehole", storeEnabled: false, cronEnabled: true, gate: { allowed: true },
    }));
    const dialog = screen.getByRole("alertdialog", { name: "Turn off Borehole?" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Turn off" }));
    });
    expect(setEnabled).toHaveBeenCalledWith("borehole", false);
  });

  it("does nothing when the question is cancelled", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(setEnabled).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("keeps the question open on the bot's reasons when it refuses", async () => {
    setEnabled.mockResolvedValue({ ok: false, detail: "refused", problems: ["enabled must be true or false"] });
    mount({ storeEnabled: false });
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Turn on" }).at(-1)!);
    });
    expect(setEnabled).toHaveBeenCalledWith("borehole", true);
    expect(screen.getByRole("alert").textContent).toMatch(/enabled must be true or false/);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("says plainly that the switch cannot make a campaign without a cron post", () => {
    mount({ cronEnabled: false });
    expect(screen.getByText("Switched on, but not posting.")).toBeTruthy();
    expect(screen.getByText(NO_CRON_NOTE)).toBeTruthy();
  });

  it("is disabled, saying why, when the bot will not take the change", () => {
    mount({ gate: { allowed: false, reason: "The bot does not accept changes to enabled yet." } });
    const button = screen.getByRole("button", { name: "Turn off" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/does not accept changes to enabled/);
  });
});

describe("campaignOffLabel", () => {
  it.each([
    [{ enabled: true }, null],
    [{ enabled: false }, "switched off"],
    [{ enabled: false, storeEnabled: false, cronEnabled: true }, "switched off"],
    [{ enabled: false, storeEnabled: true, cronEnabled: false }, "no cron registered"],
    [{ enabled: false, storeEnabled: false, cronEnabled: false }, "switched off · no cron"],
  ])("names why %j is not posting", (campaign, label) => {
    expect(campaignOffLabel(campaign)).toBe(label);
  });
});
