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

import { DeleteAccountCard } from "@/app/settings/_components/delete-account-card";

const EMAIL = "operator@example.com";
const open = () => fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
const confirm = () => screen.getAllByRole("button", { name: "Delete account" }).at(-1)!;
const field = () => screen.getByLabelText(/to confirm/);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mutate.mockResolvedValue({ ok: true });
  Object.defineProperty(window, "location", { value: { replace: mocks.replace }, writable: true });
  render(<DeleteAccountCard email={EMAIL} />);
});
afterEach(cleanup);

describe("deleting the account from Settings", () => {
  it("says what goes, and says plainly that the bot does not", () => {
    expect(screen.getByText(/cannot be undone/)).toBeTruthy();
    expect(screen.getByText(/Your bot is not removed by this/)).toBeTruthy();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

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
