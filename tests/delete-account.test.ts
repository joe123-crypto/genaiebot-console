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

/** The steps outside Firestore, recorded in the same list so the order of the
 *  whole deletion can be read off one array. Each is tested on its own in
 *  `bot-teardown.test.ts`, `workspace-pictures.test.ts` and `provision-run.test.ts`. */
const outside = vi.hoisted(() => ({
  beginDeletion: vi.fn(async (): Promise<unknown> => ({ railway: { serviceId: "svc-1", volumeId: "vol-1" } })),
  removeProvisionedBot: vi.fn(async () => ({ services: ["svc-1"], volumes: ["vol-1"] })),
  deleteWorkspacePictures: vi.fn(async () => 3),
}));

vi.mock("@/src/lib/provision-run", async (original) => ({
  ...await original<typeof import("@/src/lib/provision-run")>(),
  beginDeletion: (workspace: { id: string }) => { firestore.calls.push(`fence:${workspace.id}`); return outside.beginDeletion(); },
}));
vi.mock("@/src/lib/bot-teardown", async (original) => ({
  ...await original<typeof import("@/src/lib/bot-teardown")>(),
  removeProvisionedBot: (id: string, run: unknown) => {
    firestore.calls.push(`removeBot:${id}:${(run as { railway?: { serviceId?: string } } | null)?.railway?.serviceId ?? "-"}`);
    return outside.removeProvisionedBot();
  },
}));
vi.mock("@/src/lib/workspace-pictures", () => ({
  deleteWorkspacePictures: (id: string) => { firestore.calls.push(`deletePictures:${id}`); return outside.deleteWorkspacePictures(); },
}));

const csrf = vi.hoisted(() => ({ cookie: "a".repeat(64) as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: csrf.cookie }) }) }));

import { AccountDeletionError, deleteAccount } from "@/src/lib/account-deletion";
import { BotTeardownError } from "@/src/lib/bot-teardown";
import { ProvisioningBusyError } from "@/src/lib/provision-run";
import { RailwayError } from "@/src/lib/railway-api";
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
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); forgetCachedWorkspaces(); });

const FIRESTORE_STEPS = ["recursiveDelete:workspaces/test-workspace", "delete:consoleUsers/test-operator", "deleteUser:test-operator"];

describe("deleting the signed-in user's account", () => {
  it("removes the bot, then the pictures, then the workspace and its data, then the pointer, then the sign-in", async () => {
    await deleteAccount(TEST_OPERATOR);
    expect(firestore.calls).toEqual([
      "fence:test-workspace",
      // The run record is read before the workspace is deleted, because it is
      // the only thing that names the bot's volume once the service is gone.
      "removeBot:test-workspace:svc-1",
      "deletePictures:test-workspace",
      ...FIRESTORE_STEPS,
    ]);
  });

  it("keeps the whole account when the bot could not be removed, so asking again carries on", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    outside.removeProvisionedBot.mockRejectedValueOnce(new RailwayError("Your bot's hosting refused a step of the setup.", "Not Authorized: token sk-123"));
    const failure = await deleteAccount(TEST_OPERATOR).then(() => { throw new Error("expected a refusal"); },
      (error: unknown) => error as Error);
    expect(failure).toBeInstanceOf(AccountDeletionError);
    expect(failure.message).toBe("Your bot could not be removed, so your account was kept. Try again shortly.");
    // Railway's own words reach the log, never the message the browser is shown.
    expect(failure.message).not.toContain("sk-123");
    expect(firestore.calls).toEqual(["fence:test-workspace", "removeBot:test-workspace:svc-1"]);
  });

  it("passes on the teardown's own reason when it refused rather than failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    outside.removeProvisionedBot.mockRejectedValueOnce(new BotTeardownError("Your bot could not be identified for removal, so your account was kept."));
    await expect(deleteAccount(TEST_OPERATOR)).rejects.toThrow("could not be identified");
    expect(firestore.calls).not.toContain(FIRESTORE_STEPS[0]);
  });

  it("keeps the whole account when the pictures could not be deleted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    outside.deleteWorkspacePictures.mockRejectedValueOnce(new Error("r2 down"));
    await expect(deleteAccount(TEST_OPERATOR)).rejects.toThrow("Your stored pictures could not be deleted, so your account was kept.");
    for (const step of FIRESTORE_STEPS) expect(firestore.calls).not.toContain(step);
  });

  it("waits for a bot that is being built this instant rather than leave what it builds behind", async () => {
    outside.beginDeletion.mockRejectedValueOnce(new ProvisioningBusyError());
    await expect(deleteAccount(TEST_OPERATOR)).rejects.toThrow("Your bot is still being set up. Try again in a minute.");
    expect(firestore.calls).toEqual(["fence:test-workspace"]);
  });

  it("removes a bot it finds by name even when the run record could not be read", async () => {
    outside.beginDeletion.mockResolvedValueOnce(null);
    await deleteAccount(TEST_OPERATOR);
    expect(firestore.calls).toContain("removeBot:test-workspace:-");
    expect(firestore.calls.at(-1)).toBe("deleteUser:test-operator");
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
