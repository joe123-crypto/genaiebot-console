"use server";

import { requireOperator, auditActor } from "@/src/lib/auth";

import { revalidatePath } from "next/cache";
import { WRITES_ENABLED } from "@/src/config";
import { AccountApiError, getAccounts } from "@/src/lib/account-client";
import { ACCOUNT_ID } from "@/src/lib/account-types";
import { getConfiguration, updateLine, updateSettings } from "@/src/lib/bot-client";
import { linkedNumberChange, normalizeNumber } from "@/src/domains/line-edit";
import { READ_ONLY_OUTCOME, failedWrite, type WriteOutcome } from "@/src/lib/write-outcome";

/**
 * Guarded here as well as in the UI: a server action is a reachable POST
 * whether or not a button is rendered. Both session and write checks apply.
 */

function refresh() {
  // The advertised number shows on the lines, on every campaign's rows, and in
  // the overview; which lines exist at all is a choice on every group.
  revalidatePath("/lines");
  revalidatePath("/campaigns", "layout");
  revalidatePath("/groups", "layout");
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
  const operator = await requireOperator();
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
    await updateLine(id, { number }, { by: auditActor(operator) });
  } catch (error) {
    return failed(error);
  }
  refresh();
  return { ok: true };
}

/**
 * Give a linked line the configuration document that makes it a line the bot
 * can be told to use -- assigned to groups, named by a campaign, offered as the
 * contact number.
 *
 * The browser supplies an id and nothing else. The number is read here from the
 * gateway, as `syncLineNumberAction` reads it, so this can only ever record what
 * the linked WhatsApp account itself reports; a line with no login, or none the
 * gateway has a number for yet, is refused rather than written half-made. The
 * bot's writer drops a line whose number is empty from its own account list, so
 * such a document would be invisible to everything that matters.
 *
 * Safe to call twice: a line the bot already lists is left exactly as it is.
 */
export async function createLineAction(id: string): Promise<WriteOutcome> {
  const operator = await requireOperator();
  if (!WRITES_ENABLED) return READ_ONLY_OUTCOME;
  if (typeof id !== "string" || !ACCOUNT_ID.test(id)) return { ok: false, detail: "No valid line was named." };
  try {
    const [{ accounts }, overview] = await Promise.all([getAccounts(), getConfiguration()]);
    if (overview.accounts.some((entry) => entry.id === id)) return { ok: true };
    const live = accounts.find((entry) => entry.id === id);
    if (!live) return { ok: false, detail: "The gateway does not have this line. Refresh status before trying again." };
    // `=== false` for the same reason the screen uses it: an older gateway does
    // not report this at all, and absent must not stand for "not configured".
    if (live.configured === false) return { ok: false, detail: "The gateway has no account for this line yet. Link it first." };
    if (live.linked !== true) return { ok: false, detail: "This line has no WhatsApp login yet. Link it first." };
    const number = normalizeNumber(live.number);
    if (!number) return { ok: false, detail: "WhatsApp reports no number for this line yet. Refresh status shortly and try again." };
    await updateLine(id, { number }, { by: auditActor(operator) });
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
  const operator = await requireOperator();
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
    await updateSettings({ contact_account: id }, { by: auditActor(operator) });
  } catch (error) {
    return failed(error);
  }
  refresh();
  return { ok: true };
}
