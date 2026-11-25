import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextResponse } from "next/server";
import { TEST_OPERATOR, TEST_WORKSPACE } from "./auth-fixture";
import { getWorkspace, forgetCachedWorkspaces } from "@/src/lib/workspace";

/**
 * Deleting an account: the module that does it, and the HTTP boundary in front
 * of it. Which account is never asked for, so what matters here is that a
 * request without a session or without the CSRF pair deletes nothing, that what
 * is deleted is deleted in an order a failure can be resumed from, and that the
 * sign-in is the last thing to go.
 */

const firestore = vi.hoisted(() => ({
  recursiveDelete: vi.fn(async () => {}),
  deleteDoc: vi.fn(async () => {}),
  deleteUser: vi.fn(async () => {}),
  calls: [] as string[],
}));

vi.mock("@/src/lib/firebase-admin", () => ({
  firestoreAdmin: () => ({
    recursiveDelete: (ref: { path: string }) => { firestore.calls.push(`recursiveDelete:${ref.path}`); return firestore.recursiveDelete(); },
    collection: (name: string) => ({ doc: (id: string) => ({
      path: `${name}/${id}`,
      delete: () => { firestore.calls.push(`delete:${name}/${id}`); return firestore.deleteDoc(); },
    }) }),
  }),
  firebaseAdminAuth: () => ({
    deleteUser: (uid: string) => { firestore.calls.push(`deleteUser:${uid}`); return firestore.deleteUser(); },
  }),
  appOrigin: () => "https://console.example",
  AuthUnavailableError: class extends Error {},
}));

const csrf = vi.hoisted(() => ({ cookie: "a".repeat(64) as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: csrf.cookie }) }) }));

import { AccountDeletionError, deleteAccount } from "@/src/lib/account-deletion";
import { DELETE } from "@/app/api/workspace/route";
import { apiOperator } from "@/src/lib/auth";

const request = (extra: Record<string, string> = {}) =>
  new Request("https://console.example/api/workspace", {
    method: "DELETE",
    headers: { origin: "https://console.example", "content-type": "application/json", "x-csrf-token": "a".repeat(64), ...extra },
  });

beforeEach(() => {
  firestore.calls.length = 0;
  csrf.cookie = "a".repeat(64);
  vi.mocked(getWorkspace).mockResolvedValue(TEST_WORKSPACE);
  vi.mocked(apiOperator).mockResolvedValue(TEST_OPERATOR);
});
afterEach(() => { vi.clearAllMocks(); forgetCachedWorkspaces(); });

describe("deleting the signed-in user's account", () => {
  it("removes the workspace and its data, then the pointer, then the sign-in", async () => {
    await deleteAccount(TEST_OPERATOR);
    expect(firestore.calls).toEqual([
      "recursiveDelete:workspaces/test-workspace",
      "delete:consoleUsers/test-operator",
      "deleteUser:test-operator",
    ]);
  });

  it("deletes nothing at all when the registry cannot say whose data this is", async () => {
    vi.mocked(getWorkspace).mockRejectedValue(new Error("registry down"));
    await expect(deleteAccount(TEST_OPERATOR)).rejects.toBeInstanceOf(AccountDeletionError);
    expect(firestore.calls).toEqual([]);
  });

  it("leaves the sign-in alone when the data could not be deleted, so it can be asked again", async () => {
    firestore.recursiveDelete.mockRejectedValueOnce(new Error("firestore down"));
    await expect(deleteAccount(TEST_OPERATOR)).rejects.toBeInstanceOf(AccountDeletionError);
    expect(firestore.calls).not.toContain("deleteUser:test-operator");
  });

  it("says the data went but the sign-in did not, rather than reporting success", async () => {
    firestore.deleteUser.mockRejectedValueOnce(new Error("auth down"));
    await expect(deleteAccount(TEST_OPERATOR)).rejects.toThrow("your sign-in could not be");
  });
});

describe("deleting an account over HTTP", () => {
  it("refuses an unauthenticated request before reaching the registry", async () => {
    vi.mocked(apiOperator).mockResolvedValue(Response.json({ error: "Sign in to continue." }, { status: 401 }));
    expect((await DELETE(request())).status).toBe(401);
    expect(firestore.calls).toEqual([]);
  });

  it("refuses a cross-origin submission a session alone would otherwise carry", async () => {
    expect((await DELETE(request({ origin: "https://another-site.example" }))).status).toBe(403);
    expect(firestore.calls).toEqual([]);
  });

  it("refuses a request whose CSRF token does not match the cookie", async () => {
    csrf.cookie = "b".repeat(64);
    expect((await DELETE(request())).status).toBe(403);
    expect(firestore.calls).toEqual([]);
  });

  it("clears this browser's session once the account is gone, and caches nothing", async () => {
    const response = await DELETE(request()) as NextResponse;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const cookie = response.cookies.get("genaie_console_session");
    expect(cookie?.value).toBe("");
    expect(cookie?.maxAge).toBe(0);
    expect(cookie?.httpOnly).toBe(true);
  });

  it("answers 503 with the reason and leaves the session alone when deletion fails", async () => {
    firestore.recursiveDelete.mockRejectedValueOnce(new Error("firestore down"));
    const response = await DELETE(request()) as NextResponse;
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/could not be deleted/);
    expect(response.cookies.get("genaie_console_session")).toBeUndefined();
  });
});
