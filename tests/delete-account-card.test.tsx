// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The card that offers account deletion. The gate that matters is the typed
 * address: the button beside Cancel is one click from unrecoverable, so it must
 * stay dead until the user has written their own address out.
 */

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), announce: vi.fn(), replace: vi.fn() }));
vi.mock("@/src/lib/auth-browser", () => ({ authMutation: mocks.mutate, announceSignOut: mocks.announce }));

import { DeleteAccountCard } from "@/app/_components/delete-account-card";

const EMAIL = "operator@example.com";
const open = () => fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
const confirm = () => screen.getAllByRole("button", { name: "Delete account" }).at(-1)!;
const field = () => screen.getByLabelText(/to confirm/);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mutate.mockResolvedValue({ ok: true });
  Object.defineProperty(window, "location", { value: { replace: mocks.replace }, writable: true });
});
afterEach(cleanup);

describe("what the card says about the bot", () => {
  it("lists a bot this console created among what goes, and says its storage outlives it briefly", () => {
    render(<DeleteAccountCard email={EMAIL} bot="removed" />);
    expect(screen.getByText(/cannot be undone/)).toBeTruthy();
    expect(screen.getByText("Your bot, and the WhatsApp connection it holds")).toBeTruthy();
    expect(screen.getByText(/keeps its storage for a few days/)).toBeTruthy();
    expect(screen.queryByText(/not removed by this/)).toBeNull();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("says plainly that a bot set up by hand is not removed", () => {
    render(<DeleteAccountCard email={EMAIL} bot="manual" />);
    expect(screen.getByText(/set up by hand, so it is not removed by this/)).toBeTruthy();
    expect(screen.queryByText("Your bot, and the WhatsApp connection it holds")).toBeNull();
  });

  it("says nothing about a bot there is none of", () => {
    render(<DeleteAccountCard email={EMAIL} bot="none" />);
    expect(screen.queryByText(/Your bot/)).toBeNull();
    expect(screen.getByText("The pictures stored for your campaigns")).toBeTruthy();
  });
});

describe("deleting the account from Settings", () => {
  beforeEach(() => { render(<DeleteAccountCard email={EMAIL} bot="removed" />); });

  it("asks before deleting anything, and deletes nothing on cancel", () => {
    open();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("keeps the confirm dead until the address is written out", () => {
    open();
    expect(confirm().hasAttribute("disabled")).toBe(true);
    fireEvent.change(field(), { target: { value: "operator@example" } });
    expect(confirm().hasAttribute("disabled")).toBe(true);
    fireEvent.change(field(), { target: { value: "  OPERATOR@Example.com " } });
    expect(confirm().hasAttribute("disabled")).toBe(false);
  });

  it("forgets a half-typed address when the dialog is reopened", () => {
    open();
    fireEvent.change(field(), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    open();
    expect((field() as HTMLInputElement).value).toBe("");
    expect(confirm().hasAttribute("disabled")).toBe(true);
  });

  it("deletes, clears this browser and every other tab, then returns to login", async () => {
    open();
    fireEvent.change(field(), { target: { value: EMAIL } });
    fireEvent.click(confirm());
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(mocks.mutate).toHaveBeenCalledWith("DELETE", {}, "/api/workspace");
    expect(mocks.announce).toHaveBeenCalledOnce();
  });

  it("stays open on the reason when the deletion is refused, and signs nobody out", async () => {
    mocks.mutate.mockRejectedValue(new Error("Your account could not be deleted. Try again shortly."));
    open();
    fireEvent.change(field(), { target: { value: EMAIL } });
    fireEvent.click(confirm());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/could not be deleted/));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(mocks.announce).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
