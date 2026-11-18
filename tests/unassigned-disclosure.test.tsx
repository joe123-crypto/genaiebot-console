// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DiscoveredGroups } from "@/app/groups/_components/discovered-groups";

afterEach(cleanup);
const props = { groups: [], total: 4 };
it("starts collapsed, toggles, keeps its state during updates, and restores focus on Escape", () => {
  const view = render(<DiscoveredGroups {...props} />);
  const toggle = screen.getByRole("button", { name: "Unassigned 4" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("region", { name: "Unassigned groups" })).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByRole("region", { name: "Unassigned groups" })).toBeTruthy();
  view.rerender(<DiscoveredGroups {...props} total={5} pagination={<button>More discoveries</button>} />);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("region", { name: "Unassigned groups" }).contains(screen.getByText("More discoveries"))).toBe(true);
  screen.getByText("More discoveries").focus();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(toggle);
  fireEvent.click(toggle);
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});
it("dismisses outside the panel but leaves action dialogs open", () => {
  render(<><DiscoveredGroups {...props} /><button>Outside</button></>);
  const toggle = screen.getByRole("button", { name: "Unassigned 4" });
  fireEvent.click(toggle);
  fireEvent.pointerDown(screen.getByText("Outside"));
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  const dialog = document.createElement("div");
  dialog.setAttribute("aria-modal", "true"); document.body.append(dialog);
  fireEvent.pointerDown(dialog);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  dialog.remove();
});

it("closes when keyboard focus moves to the controls below the overlay", () => {
  render(<><DiscoveredGroups {...props} /><button>Search controls</button></>);
  const toggle = screen.getByRole("button", { name: "Unassigned 4" });
  fireEvent.click(toggle);
  fireEvent.blur(toggle, { relatedTarget: screen.getByText("Search controls") });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});
it("keeps the overlay open when Escape dismisses a real removal confirmation", () => {
  render(<DiscoveredGroups groups={[{ jid: "1@g.us", name: "Market", firstSeenAt: "2026-11-18T10:00:00Z",
    lastSeenAt: "2026-11-18T10:00:00Z", accounts: [] }]} removeGate={{ allowed: true }} />);
  const toggle = screen.getByRole("button", { name: "Unassigned 1" });
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button", { name: "Remove Market from Unassigned" }));
  fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
});

it("does not consume Escape after its target dialog has already unmounted", () => {
  render(<DiscoveredGroups {...props} />);
  const toggle = screen.getByRole("button", { name: "Unassigned 4" });
  fireEvent.click(toggle);
  const dialog = document.createElement("div");
  dialog.setAttribute("aria-modal", "true");
  const cancel = document.createElement("button"); dialog.append(cancel);
  screen.getByRole("region", { name: "Unassigned groups" }).append(dialog);
  dialog.addEventListener("keydown", () => dialog.remove());
  fireEvent.keyDown(cancel, { key: "Escape" });
  expect(dialog.isConnected).toBe(false);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
});
