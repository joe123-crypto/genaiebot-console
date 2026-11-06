"use server";

import { revalidatePath } from "next/cache";
import { OPERATOR_NAME, WRITES_ENABLED } from "@/src/config";
import { BotUnavailableError, WritesDisabledError, deleteGroup } from "@/src/lib/bot-client";

export type DeleteOutcome = { ok: true } | { ok: false; detail: string };

/**
 * Remove a group from the bot's records.
 *
 * Guarded here as well as in the UI. The control is hidden when writes are
 * off, but a hidden control is not an absent endpoint: a server action is a
 * reachable POST whether or not anything renders a button for it, and with no
 * login in front of the console that check is the only one there is.
 *
 * Failures come back as a value rather than a thrown error. The row that
 * raised it is the right place to say so — throwing would replace the whole
 * table with an error page and lose the operator their place.
 */
export async function deleteGroupAction(
  jid: string,
  reason?: string,
): Promise<DeleteOutcome> {
  if (!WRITES_ENABLED) {
    return { ok: false, detail: "The console is in read-only mode." };
  }
  if (!jid) return { ok: false, detail: "No group was named." };

  try {
    await deleteGroup(jid, { by: OPERATOR_NAME, reason });
  } catch (error) {
    if (error instanceof WritesDisabledError || error instanceof BotUnavailableError) {
      return { ok: false, detail: error.detail };
    }
    throw error;
  }

  // The sidebar counts come from the overview, so both have to be re-read for
  // the table and the badge to agree a second after the delete.
  revalidatePath("/groups");
  revalidatePath("/");
  return { ok: true };
}
