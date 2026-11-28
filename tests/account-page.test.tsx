// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The account screen and the chip that reaches it.
 *
 * Three things here are new rather than borrowed, and each is wrong silently
 * rather than loudly: the registry date (a bad parse puts 1970 on someone's
 * account page), the chip's live-updates line (which must stay out of the
 * link's accessible name), and the bot row, which is the one value on the
 * page that says something different depending on the workspace.
 */

const mocks = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));

import { registryDate } from "@/src/lib/workspace";
import { avatarInitial } from "@/src/lib/format";
import { AccountLink } from "@/app/_components/account-link";

afterEach(cleanup);

describe("a date the registry wrote", () => {
  const iso = "2026-11-04T08:30:00.000Z";

  it("reads a Firestore Timestamp", () => {
    expect(registryDate({ toDate: () => new Date(iso) })).toBe(iso);
  });

  it("reads a plain Date", () => {
    expect(registryDate(new Date(iso))).toBe(iso);
  });

  it("has nothing to say about a workspace registered before the field existed", () => {
    expect(registryDate(undefined)).toBeNull();
    expect(registryDate(null)).toBeNull();
  });

  // A server timestamp mid-write is a sentinel, not a time. Reading it as one
  // is how a page ends up claiming someone signed up in 1970.
  it("refuses a value that is not a readable instant", () => {
    expect(registryDate({ isEqual: () => false })).toBeNull();
    expect(registryDate({ toDate: () => new Date(Number.NaN) })).toBeNull();
    expect(registryDate("2026-11-04")).toBeNull();
    expect(registryDate({ toDate: () => { throw new Error("no"); } })).toBeNull();
  });
});

describe("the avatar's one letter", () => {
  it("takes the first letter of the name, upper case", () => {
    expect(avatarInitial("Joseph Munemo")).toBe("J");
    expect(avatarInitial("  ada lovelace")).toBe("A");
  });

  // operatorFromToken falls back to the address when the token has no name.
  it("works on an address, and leaves something to draw when there is no name", () => {
    expect(avatarInitial("operator@example.com")).toBe("O");
    expect(avatarInitial("   ")).toBe("?");
    expect(avatarInitial("")).toBe("?");
  });
});

describe("the chip at the foot of the sidebar", () => {
  const chip = () => screen.getByRole("link");

  it("goes to the account page and names the operator", () => {
    mocks.pathname = "/campaigns";
    render(<AccountLink name="Joseph Munemo" meta="joseph@example.com" />);
    expect(chip().getAttribute("href")).toBe("/account");
    expect(chip().textContent).toContain("Joseph Munemo");
    expect(chip().textContent).toContain("joseph@example.com");
  });

  it("lights up on its own page and nowhere else", () => {
    mocks.pathname = "/account";
    const { unmount } = render(<AccountLink name="Joseph" meta="j@example.com" />);
    expect(chip().getAttribute("aria-current")).toBe("page");
    unmount();

    mocks.pathname = "/settings";
    render(<AccountLink name="Joseph" meta="j@example.com" />);
    expect(chip().getAttribute("aria-current")).toBeNull();
  });

  // The avatar is decorative and the refresh line is a status region; neither
  // belongs in what a screen reader reads out as this link.
  it("carries neither the decorative initial nor the live-updates status", () => {
    mocks.pathname = "/";
    render(<AccountLink name="Joseph Munemo" meta="joseph@example.com" />);
    expect(chip().textContent).not.toContain("Live updates");
    expect(within(chip()).getByText("J").getAttribute("aria-hidden")).toBe("true");
  });
});
