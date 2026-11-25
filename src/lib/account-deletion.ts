import "server-only";
import type { Operator } from "./auth-types";
import { firebaseAdminAuth, firestoreAdmin } from "./firebase-admin";
import { USERS_COLLECTION, forgetCachedWorkspaces, getWorkspace } from "./workspace";

/**
 * Deleting the signed-in user's account.
 *
 * Which account is never asked for: the workspace comes from `getWorkspace`,
 * which resolves the session's own uid and refuses a pointer to a workspace the
 * user does not own (`canAccess`). Nothing here reads an id from a request, so
 * this cannot be pointed at anybody else's data.
 *
 * What goes, in this order:
 *
 *   1. `workspaces/{id}` and everything beneath it -- the registry entry and
 *      the workspace's own data: groups, campaigns, lines, settings, audit.
 *   2. `consoleUsers/{uid}`, the pointer to it.
 *   3. The Firebase sign-in itself.
 *
 * The sign-in dies last on purpose. A failure part-way leaves the user able to
 * sign in and ask again, rather than locked out of a half-deleted workspace
 * only an operator could finish clearing.
 *
 * What does **not** go: the workspace's bot. It is a service of its own, with
 * its own volume, domain and stored pictures, created by hand
 * (`docs/provision-bot.md`); the console has no credentials for it and makes no
 * attempt. The screen that offers this says so rather than implying otherwise.
 */
export class AccountDeletionError extends Error {
  constructor(detail = "Your account could not be deleted. Try again shortly.") {
    super(detail);
    this.name = "AccountDeletionError";
  }
}

export async function deleteAccount(operator: Operator): Promise<void> {
  let workspaceId: string | null;
  try {
    workspaceId = (await getWorkspace())?.id ?? null;
  } catch {
    // The registry could not be read, so which data is this user's is unknown.
    // Deleting the sign-in now would strand it, so nothing is deleted at all.
    throw new AccountDeletionError();
  }
  if (!workspaceId) throw new AccountDeletionError("Sign in to continue.");

  const db = firestoreAdmin();
  try {
    // One call for the document and every subcollection under it.
    await db.recursiveDelete(db.collection("workspaces").doc(workspaceId));
    await db.collection(USERS_COLLECTION).doc(operator.uid).delete();
  } catch {
    forgetCachedWorkspaces();
    throw new AccountDeletionError();
  }

  try {
    // Every other device's session fails its next revocation check with
    // auth/user-not-found, which `isInvalidCredential` already reads as signed
    // out, so no session outlives this.
    await firebaseAdminAuth().deleteUser(operator.uid);
  } catch {
    forgetCachedWorkspaces();
    throw new AccountDeletionError("Your data was deleted, but your sign-in could not be. Try again shortly.");
  }
  // Per process: another instance can still serve its cached workspace for up
  // to the 30 seconds it caches, as it can after any other workspace change.
  forgetCachedWorkspaces();
}
