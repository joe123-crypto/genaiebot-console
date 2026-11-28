// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the account screen says about a workspace. The bot row and the signup
 * date are the two values that differ between users, so they are the two the
 * page can get wrong without anything throwing.
 */

const mocks = vi.hoisted(() => ({
  workspace: {
    id: "wk-alice1", name: "Alice's workspace", ownerUid: "test-operator",
    bot: { baseUrl: "https://alice-bot.example" } as { baseUrl: string } | null,
    onboarding: "done" as "done" | "skipped",
    createdAt: "2026-11-04T08:30:00.000Z" as string | null,
  },
  signUpDate: vi.fn(async () => null as string | null),
}));

vi.mock("@/app/_components/shell-wrapper", () => ({
  Shell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/src/lib/bot-teardown", () => ({ botRemovalOf: async () => "none" as const }));
vi.mock("@/src/lib/account-profile", () => ({ signUpDate: mocks.signUpDate }));
vi.mock("@/src/lib/workspace", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/workspace")>(),
  requireWorkspace: async () => mocks.workspace,
}));

import AccountPage from "@/app/account/page";

const show = async () => render(await AccountPage() as React.ReactElement);

beforeEach(() => {
  mocks.workspace = {
    id: "wk-alice1", name: "Alice's workspace", ownerUid: "test-operator",
    bot: { baseUrl: "https://alice-bot.example" }, onboarding: "done",
    createdAt: "2026-11-04T08:30:00.000Z",
  };
  mocks.signUpDate.mockClear();
  mocks.signUpDate.mockResolvedValue(null);
});
afterEach(cleanup);

describe("who is signed in", () => {
  it("names the operator and the day the workspace was made", async () => {
    await show();
    expect(screen.getAllByText("Test Operator").length).toBeGreaterThan(0);
    expect(screen.getAllByText("operator@example.com").length).toBeGreaterThan(0);
    // The hero's "Member since" and the profile's "Signed up". Not a third
    // time under Workspace: that would be the same instant printed again.
    expect(screen.getAllByText("4 November 2026").length).toBe(2);
  });

  it("names the workspace and its id", async () => {
    await show();
    expect(screen.getAllByText("Alice's workspace").length).toBeGreaterThan(0);
    expect(screen.getByText("wk-alice1")).toBeTruthy();
  });
});

describe("the signup date", () => {
  // A workspace registered before the console wrote the date down.
  it("falls back to the Firebase sign-in date when the registry has none", async () => {
    mocks.workspace.createdAt = null;
    mocks.signUpDate.mockResolvedValue("2026-01-09T06:00:00.000Z");
    await show();
    expect(mocks.signUpDate).toHaveBeenCalledWith("test-operator");
    expect(screen.getAllByText("9 January 2026").length).toBe(2);
  });

  it("says so plainly when neither source knows, rather than inventing one", async () => {
    mocks.workspace.createdAt = null;
    await show();
    expect(screen.getByText("Not recorded")).toBeTruthy();
    expect(screen.queryByText(/Member since/)).toBeNull();
  });

  // The registry's date is already in hand; the extra Admin call is only for
  // the workspaces that have none.
  it("asks Firebase nothing when the registry has the date", async () => {
    await show();
    expect(mocks.signUpDate).not.toHaveBeenCalled();
  });
});

describe("the bot row", () => {
  it("says connected, and where, when the workspace has a bot", async () => {
    await show();
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("https://alice-bot.example")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Set up your bot" })).toBeNull();
  });

  it("offers the way to make one when the workspace has no bot", async () => {
    mocks.workspace.bot = null;
    await show();
    expect(screen.getByRole("link", { name: "Set up your bot" }).getAttribute("href")).toBe("/setup");
    expect(screen.queryByText("Connected")).toBeNull();
  });

  it("says a skipped wizard is skipped, and left nothing missing", async () => {
    mocks.workspace.onboarding = "skipped";
    await show();
    expect(screen.getByText("Skipped")).toBeTruthy();
    expect(screen.getByText(/each page offers what it needs/)).toBeTruthy();
  });
});
