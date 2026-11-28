import "server-only";
import { firebaseAdminAuth } from "./firebase-admin";

/**
 * When the user signed in for the first time, according to Firebase Auth.
 *
 * The registry's own `createdAt` is the answer for everyone who signed up
 * after it began being written, and it is already in hand by the time a page
 * renders. This is the fallback for the few workspaces made before that, and
 * so it is asked for only when the registry has nothing: it is an extra Admin
 * call, and the account screen is not worth one on every view.
 *
 * Never allowed to fail a page. Auth being unreachable means the date is not
 * known, which is what the screen already says when nobody recorded one.
 */
export async function signUpDate(uid: string): Promise<string | null> {
  try {
    const recorded = (await firebaseAdminAuth().getUser(uid)).metadata.creationTime;
    const at = recorded ? new Date(recorded) : null;
    return at && Number.isFinite(at.getTime()) ? at.toISOString() : null;
  } catch {
    return null;
  }
}
