"use server";

import { revalidatePath } from "next/cache";
import { OPERATOR_NAME, WRITES_ENABLED } from "@/src/config";
import { deleteGroup, getGroups, getCapabilities, getCampaignState, getConfiguration, groupAction, updateGroup } from "@/src/lib/bot-client";
import { emptyGroupDraft, planAssignmentWrites } from "@/src/lib/campaign-group-draft";
import { canWrite } from "@/src/lib/write-capabilities";
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
  const overview = await getConfiguration();
  return {
    lines: overview.accounts.map((line) => line.id),
    tiers: overview.capSettings ? Object.keys(overview.capSettings.bands) : TIERS_FALLBACK,
  };
}

/** Add one campaign without sending the browser's potentially stale membership list. */
export async function addGroupCampaignAction(jid: string, slug: string): Promise<WriteOutcome> {
  if (!WRITES_ENABLED) return READ_ONLY_OUTCOME;
  if (typeof jid !== "string" || !jid.endsWith("@g.us")) {
    return { ok: false, detail: "No valid group was named." };
  }
  if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return { ok: false, detail: "No valid campaign was named." };
  }

  try {
    const [{ groups }, writes, campaign] = await Promise.all([getGroups(undefined, { fresh: true, jid }), getCapabilities(), getCampaignState(slug)]);
    const gate = canWrite(WRITES_ENABLED, writes, "groups", "promos");
    if (!gate.allowed) return { ok: false, detail: gate.reason };
    if (!campaign) {
      return { ok: false, detail: "This campaign is no longer on record." };
    }

    const plan = planAssignmentWrites(slug, { ...emptyGroupDraft(), added: [jid] }, groups);
    if (plan.failures.length > 0) return { ok: false, detail: plan.failures[0].detail };
    for (const write of plan.writes) {
      await updateGroup(write.jid, write.fields, { by: OPERATOR_NAME, dryRun: true });
      await updateGroup(write.jid, write.fields, { by: OPERATOR_NAME });
    }
  } catch (error) {
    return failedWrite(error);
  }

  // Refresh even if another operator already added it, so the row catches up.
  refresh();
  revalidatePath(`/campaigns/${slug}`);
  revalidatePath("/campaigns");
  return { ok: true };
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
    const [{ groups }, words] = await Promise.all([getGroups(undefined, { fresh: true, jid }), vocabulary()]);
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

/** What a delete was asked to do beyond removing the record. Both are off
 *  unless the operator ticked them. */
export type DeleteGroupOptions = {
  reason?: string;
  /** Take the bot's number out of the WhatsApp group. */
  leave?: boolean;
  /** Forget the per-campaign send history for the group. */
  clearRecords?: boolean;
  /** The line that is in the group. Read from the row before the delete,
   *  because the record that carries it is gone by the time we leave. */
  account?: string;
};

/**
 * Remove a group from the bot's records, and optionally take the bot out of the
 * WhatsApp group and forget what it stored about it.
 *
 * **The order is deliberate: record, then leave, then records.**
 *
 * Deleting the record is the step that can still be refused -- the bot
 * re-validates the whole prospective config and will reject a delete that would
 * break something. Leaving is the step that cannot be undone without a new
 * invite. So the refusable one goes first: if the leave then fails, the group
 * simply reappears under Unassigned, which is what a plain delete has always
 * done. The other way round, a refused delete would leave the bot outside a
 * group it is still configured to advertise to, and every later send into it
 * would fail.
 *
 * A leave or a clear that does not come off therefore does not make the delete
 * a failure. It comes back as a warning on a successful outcome, because the
 * record really is gone and saying otherwise would invite a retry.
 */
export async function deleteGroupAction(
  jid: string,
  options: DeleteGroupOptions | string = {},
): Promise<WriteOutcome> {
  if (!WRITES_ENABLED) return READ_ONLY_OUTCOME;
  if (!jid) return { ok: false, detail: "No group was named." };
  // A bare reason is the shape this took before there was anything else to ask
  // for; keeping it means an older caller cannot silently lose its reason.
  const { reason, leave = false, clearRecords = false, account } =
    typeof options === "string" ? { reason: options } as DeleteGroupOptions : options;
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length > 500) return { ok: false, detail: "The reason must be 500 characters or fewer." };

  try {
    await deleteGroup(jid, { by: OPERATOR_NAME, ...(why ? { reason: why } : {}) });
  } catch (error) {
    return failedWrite(error);
  }

  const warnings: string[] = [];
  if (leave || clearRecords) {
    try {
      const result = await groupAction(jid, {
        leave, clearRecords, account, by: OPERATOR_NAME,
      });
      warnings.push(...groupActionWarnings(result, { leave, clearRecords }));
    } catch (error) {
      const outcome = failedWrite(error);
      // The record is gone either way, so this is a warning on a success, not
      // a failure that would have the operator delete it again.
      warnings.push(outcome.ok
        ? "The bot did not say what it did about the WhatsApp group."
        : `${leave ? "The bot may still be in the WhatsApp group" : "The group's stored records may not have been cleared"}: ${outcome.detail}`);
    }
  }

  refresh();
  return warnings.length > 0 ? { ok: true, warnings } : { ok: true };
}

/** The bot's answer, in words for the operator. Only what did NOT happen is
 *  worth saying: the record is gone and the dialog is about to close. */
function groupActionWarnings(
  result: Awaited<ReturnType<typeof groupAction>>,
  asked: { leave: boolean; clearRecords: boolean },
): string[] {
  const warnings: string[] = [];
  if (asked.leave) {
    const leave = result?.leave;
    if (!leave?.requested) {
      warnings.push("The bot did not act on the WhatsApp group.");
    } else if (leave.ok === null || leave.ok === undefined) {
      // Queued but unanswered. Not a failure, and not a success either.
      warnings.push(
        "Leaving the WhatsApp group was not confirmed. The request is queued, so check the group before asking again.");
    } else if (!leave.ok) {
      warnings.push(leave.error === "not_authorized"
        ? "The bot could not leave the WhatsApp group: its account was not allowed to."
        : "The bot could not leave the WhatsApp group, so its number is still in it.");
    }
  }
  if (asked.clearRecords && !result?.cleared?.requested) {
    warnings.push("The group's stored records were not cleared.");
  }
  return warnings;
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
    const { groups, discoveredGroups } = await getGroups(undefined, { fresh: true, jid });
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
