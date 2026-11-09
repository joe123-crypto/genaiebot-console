"use server";

import { revalidatePath } from "next/cache";
import { OPERATOR_NAME, WRITES_ENABLED } from "@/src/config";
import { AccountApiError, getAccounts } from "@/src/lib/account-client";
import { ACCOUNT_ID } from "@/src/lib/account-types";
import { getConfiguration, updateLine, updateSettings } from "@/src/lib/bot-client";
import { linkedNumberChange } from "@/src/domains/line-edit";
import { READ_ONLY_OUTCOME, failedWrite, type WriteOutcome } from "@/src/lib/write-outcome";

/**
 * Guarded here as well as in the UI: a server action is a reachable POST
 * whether or not a button for it is rendered, and the console has no login.
 */

function refresh() {
  // The advertised number shows on the lines, on every campaign's rows, and in
  // the overview.
  revalidatePath("/lines");
  revalidatePath("/campaigns", "layout");
  revalidatePath("/");
}

function failed(error: unknown): WriteOutcome {
  if (error instanceof AccountApiError) return { ok: false, detail: error.message };
  return failedWrite(error);
}

/**
 * Make a line's configured number the one its linked WhatsApp account reports.
 * The number comes from the gateway, read here on the server -- never from the
 * browser -- so this can only ever copy what WhatsApp itself says.
 */
export async function syncLineNumberAction(id: string): Promise<WriteOutcome> {
  if (!WRITES_ENABLED) return READ_ONLY_OUTCOME;
  if (typeof id !== "string" || !ACCOUNT_ID.test(id)) return { ok: false, detail: "No valid line was named." };
  try {
    const [{ accounts }, overview] = await Promise.all([getAccounts(), getConfiguration()]);
    const line = overview.accounts.find((entry) => entry.id === id);
    // The writer edits lines; it does not create them.
    if (!line) return { ok: false, detail: "This line is not in the bot's configuration." };
    const live = accounts.find((entry) => entry.id === id)?.number;
    const number = linkedNumberChange(line.number, live);
    if (!number) {
      return live ? { ok: true } : { ok: false, detail: "WhatsApp reports no number for this line. Link it first." };
    }
    await updateLine(id, { number }, { by: OPERATOR_NAME });
  } catch (error) {
    return failed(error);
  }
  refresh();
  return { ok: true };
}

/**
 * Choose the line whose number every advert gives as the one to contact,
 * whichever line posts it -- or `null` for each advert to give its own line's.
 */
export async function setContactLineAction(id: string | null): Promise<WriteOutcome> {
  if (!WRITES_ENABLED) return READ_ONLY_OUTCOME;
  if (id !== null && (typeof id !== "string" || !ACCOUNT_ID.test(id))) {
    return { ok: false, detail: "No valid line was named." };
  }
  try {
    const overview = await getConfiguration();
    const current = overview.accounts.find((entry) => entry.isContact)?.id ?? null;
    if (current === id) return { ok: true };
    if (id !== null && !overview.accounts.some((entry) => entry.id === id && entry.number)) {
      return { ok: false, detail: "Only a line with a number can be the contact line." };
    }
    await updateSettings({ contact_account: id }, { by: OPERATOR_NAME });
  } catch (error) {
    return failed(error);
  }
  refresh();
  return { ok: true };
}
