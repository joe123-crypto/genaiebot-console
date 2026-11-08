"use server";

import { revalidatePath } from "next/cache";
import { OPERATOR_NAME, WRITES_ENABLED } from "@/src/config";
import { deleteGroup, getGroups, getOverview, updateGroup } from "@/src/lib/bot-client";
import {
  changedGroupFields,
  currentGroupValues,
  groupEditProblems,
  newGroupFromDiscovered,
  type GroupEdit,
  type GroupEditField,
} from "@/src/domains/group-edit";
import { READ_ONLY_OUTCOME, failedWrite, type WriteOutcome } from "@/src/lib/write-outcome";
import type { Group } from "@/src/lib/types";

/**
 * Every action here is guarded twice: in the UI, and again here. A hidden
 * control is not an absent endpoint -- a server action is a reachable POST
 * whether or not anything renders a button for it, and with no login in front
 * of the console this check is the only one there is.
 *
 * Failures come back as a value rather than a thrown error. The row or dialog
 * that raised it is the right place to say so; throwing would replace the whole
 * table with an error page and lose the operator their place.
 */

const TIERS_FALLBACK = ["busy", "normal", "quiet"];

function refresh() {
  // The sidebar counts come from the overview, so both have to be re-read for
  // the table and the badge to agree a second after the change.
  revalidatePath("/groups");
  revalidatePath("/");
}

/** The lines and tiers a field may name, from the bot's own read model. */
async function vocabulary(): Promise<{ lines: string[]; tiers: string[] }> {
  const overview = await getOverview();
  return {
    lines: overview.accounts.map((line) => line.id),
    tiers: overview.capSettings ? Object.keys(overview.capSettings.bands) : TIERS_FALLBACK,
  };
}

/**
 * Change one group's own settings.
 *
 * `expected` is what the dialog showed when it opened, for the fields being
 * changed. If any of those moved since -- another tab, the Firebase Console --
 * the change is refused rather than written over the newer value. Fields the
 * dialog did not change are not compared, so an unrelated edit elsewhere on the
 * same group does not block this one.
 */
export async function updateGroupAction(
  jid: string,
  form: GroupEdit,
  expected: GroupEdit,
): Promise<WriteOutcome> {
  if (!WRITES_ENABLED) return READ_ONLY_OUTCOME;
  if (typeof jid !== "string" || !jid.endsWith("@g.us")) {
    return { ok: false, detail: "No valid group was named." };
  }
  if (!form || typeof form !== "object" || !expected || typeof expected !== "object") {
    return { ok: false, detail: "The change could not be read." };
  }

  try {
    const [{ groups }, words] = await Promise.all([getGroups(), vocabulary()]);
    const group = groups.find((entry) => entry.jid === jid);
    if (!group) return { ok: false, detail: "This group is no longer on record." };

    const change = changedGroupFields(group, form);
    const fields = Object.keys(change) as GroupEditField[];
    if (fields.length === 0) return { ok: true };

    const problems = groupEditProblems(change, words);
    if (problems.length > 0) {
      return { ok: false, detail: "The change was not sent.", problems };
    }
    const current = currentGroupValues(group);
    const moved = fields.filter((field) => field in expected && expected[field] !== current[field]);
    if (moved.length > 0) {
      return {
        ok: false,
        detail: "This group changed since you started editing. Close the dialog and reopen it to load the latest.",
      };
    }
    await updateGroup(jid, change, { by: OPERATOR_NAME });
  } catch (error) {
    return failedWrite(error);
  }
  refresh();
  return { ok: true };
}

/**
 * Remove a group from the bot's records. The bot commits the whole record into
 * its audit trail in the same write, so it can be recreated from there; while
 * the bot is still in the WhatsApp group, discovery lists it again as unassigned.
 */
export async function deleteGroupAction(jid: string, reason?: string): Promise<WriteOutcome> {
  if (!WRITES_ENABLED) return READ_ONLY_OUTCOME;
  if (!jid) return { ok: false, detail: "No group was named." };
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length > 500) return { ok: false, detail: "The reason must be 500 characters or fewer." };

  try {
    await deleteGroup(jid, { by: OPERATOR_NAME, ...(why ? { reason: why } : {}) });
  } catch (error) {
    return failedWrite(error);
  }
  refresh();
  return { ok: true };
}

/**
 * Put a group that automatic discovery found on record: active, on the line that
 * saw it, and in no campaign. Nothing is sent to it until a campaign assigns it.
 *
 * The group is looked up in the bot's own discovered list rather than taken from
 * the browser, so the console can only add a group the bot has actually seen.
 */
export async function addDiscoveredGroupAction(jid: string): Promise<WriteOutcome> {
  if (!WRITES_ENABLED) return READ_ONLY_OUTCOME;
  if (typeof jid !== "string" || !jid.endsWith("@g.us")) {
    return { ok: false, detail: "No valid group was named." };
  }
  try {
    const { groups, discoveredGroups } = await getGroups();
    if (groups.some((entry: Group) => entry.jid === jid)) {
      return { ok: false, detail: "This group is already on record." };
    }
    const found = (discoveredGroups ?? []).find((entry) => entry.jid === jid);
    if (!found) {
      return { ok: false, detail: "The bot no longer lists this group as discovered." };
    }
    await updateGroup(jid, newGroupFromDiscovered(found), { by: OPERATOR_NAME });
  } catch (error) {
    return failedWrite(error);
  }
  refresh();
  return { ok: true };
}
