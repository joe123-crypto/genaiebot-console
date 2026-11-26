import "server-only";
import type { Operator } from "./auth-types";
import { BotTeardownError, removeProvisionedBot, teardownUpstream } from "./bot-teardown";
import { firebaseAdminAuth, firestoreAdmin } from "./firebase-admin";
import { ProvisioningBusyError, beginDeletion } from "./provision-run";
import { USERS_COLLECTION, forgetCachedWorkspaces, getWorkspace, type Workspace } from "./workspace";
import { deleteWorkspacePictures } from "./workspace-pictures";

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
 *   1. Nothing yet: provisioning is fenced off (`beginDeletion`), so no poll
 *      can build a service after step 2 has looked for one.
 *   2. The bot this console created for the workspace -- its Railway service,
 *      then its volume (`./bot-teardown`). Railway keeps a deleted volume for a
 *      few days before erasing it. A bot connected by hand is not this
 *      console's to delete, and the screen says so.
 *   3. The workspace's pictures in R2, under `w/<id>/` (`./workspace-pictures`).
 *   4. `workspaces/{id}` and everything beneath it -- the registry entry, the
 *      run record and the workspace's own data: groups, campaigns, lines,
 *      settings, audit.
 *   5. `consoleUsers/{uid}`, the pointer to it.
 *   6. The Firebase sign-in itself.
 *
 * Everything outside Firestore goes first, for two reasons. The run record in
 * step 4 is the only thing that names the bot's volume once its service is
 * gone, so it must outlive the teardown. And a bot left running writes back
 * into `workspaces/{id}` after its tree is deleted. If Railway or R2 refuses,
 * the deletion stops there with the account intact, and asking again carries
 * on: every step reads before it acts, so what is already gone is skipped.
 *
 * The sign-in dies last on purpose. A failure part-way leaves the user able to
 * sign in and ask again, rather than locked out of a half-deleted workspace
 * only an operator could finish clearing.
 */
export class AccountDeletionError extends Error {
  constructor(detail = "Your account could not be deleted. Try again shortly.") {
    super(detail);
    this.name = "AccountDeletionError";
  }
}

const BOT_NOT_REMOVED = "Your bot could not be removed, so your account was kept. Try again shortly.";
const PICTURES_NOT_REMOVED = "Your stored pictures could not be deleted, so your account was kept. Try again shortly.";

/** Steps 1 to 3: everything that lives outside this console's own Firestore. */
async function removeOutsideData(workspace: Workspace): Promise<void> {
  let run;
  try {
    run = await beginDeletion(workspace);
  } catch (error) {
    throw new AccountDeletionError(error instanceof ProvisioningBusyError ? error.detail : undefined);
  }
  try {
    await removeProvisionedBot(workspace.id, run);
  } catch (error) {
    // Railway's own words are for this log, never the browser: a GraphQL error
    // can quote the request, and the request carries the account token.
    console.error("[account-deletion] the bot could not be removed", {
      workspace: workspace.id, service: run?.railway.serviceId, volume: run?.railway.volumeId,
      upstream: teardownUpstream(error), error: error instanceof BotTeardownError ? error.message : undefined,
    });
    throw new AccountDeletionError(error instanceof BotTeardownError ? error.message : BOT_NOT_REMOVED);
  }
  try {
    await deleteWorkspacePictures(workspace.id);
  } catch (error) {
    console.error("[account-deletion] the pictures could not be deleted", {
      workspace: workspace.id, error: error instanceof Error ? error.name : "unknown",
    });
    throw new AccountDeletionError(PICTURES_NOT_REMOVED);
  }
}

export async function deleteAccount(operator: Operator): Promise<void> {
  let workspace: Workspace | null;
  try {
    workspace = await getWorkspace();
  } catch {
    // The registry could not be read, so which data is this user's is unknown.
    // Deleting the sign-in now would strand it, so nothing is deleted at all.
    throw new AccountDeletionError();
  }
  if (!workspace) throw new AccountDeletionError("Sign in to continue.");

  await removeOutsideData(workspace);

  const db = firestoreAdmin();
  try {
    // One call for the document and every subcollection under it.
    await db.recursiveDelete(db.collection("workspaces").doc(workspace.id));
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
