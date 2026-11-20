"use server";

import { requireOperator, auditActor } from "@/src/lib/auth";

import { revalidatePath } from "next/cache";
import { WRITES_ENABLED } from "@/src/config";
import { deleteGroup, getGroups, getCapabilities, getCampaignState, getConfiguration, groupAction, removeGroupDiscovery, updateGroup, updateGroupBatch, WriteRefusedError, type GroupBatchChange } from "@/src/lib/bot-client";
import { canAct, canWrite } from "@/src/lib/write-capabilities";
import {
  changedGroupFields,
  currentGroupValues,
  groupEditProblems,
  MAX_GROUPS_PER_ASSIGNMENT,
  newGroupFromDiscovered,
  type GroupEdit,
  type GroupEditField,
} from "@/src/domains/group-edit";
import { READ_ONLY_OUTCOME, failedWrite, type WriteOutcome } from "@/src/lib/write-outcome";
import { campaignDaysProblem, isEveryDay, weekdayTokens, type CampaignDays } from "@/src/domains/campaign-days";
import { planAssignmentWrites } from "@/src/lib/campaign-group-draft";
import { confirmLabel } from "@/src/lib/format";
import type { Group } from "@/src/lib/types";

/**
 * Every action here is guarded twice: in the UI, and again here. A hidden
 * control is not an absent endpoint -- a server action is a reachable POST
 * whether or not anything renders a button for it. Every entrypoint first
 * verifies the session, then applies these independent write gates.
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

/** A changed assignment shows in three places: the groups table and its sidebar
 *  count, the campaign list, and the campaign's own page. */
function refreshAssignment(slugs: string[]) {
  refresh();
  for (const slug of slugs) revalidatePath(`/campaigns/${slug}`);
  revalidatePath("/campaigns");
}

/** The lines and tiers a field may name, from the bot's own read model. */
async function vocabulary(): Promise<{ lines: string[]; tiers: string[] }> {
  const overview = await getConfiguration();
  return {
    lines: overview.accounts.map((line) => line.id),
    tiers: overview.capSettings ? Object.keys(overview.capSettings.bands) : TIERS_FALLBACK,
  };
}

/** Add campaigns using the group's current membership. */
export async function addGroupCampaignAction(
  jid: string, selection: string | string[], days?: CampaignDays,
): Promise<WriteOutcome> {
  const operator = await requireOperator();
  return assignGroupCampaigns([jid], Array.isArray(selection) ? selection : [selection], false, auditActor(operator), days);
}

type GroupAssignmentOutcome = WriteOutcome & { refreshLive?: boolean };

/** Add each selected campaign to each selected group. */
export async function addGroupCampaignsAction(
  jids: string[], slugs: string[], days?: CampaignDays,
): Promise<GroupAssignmentOutcome> {
  const operator = await requireOperator();
  return assignGroupCampaigns(jids, slugs, true, auditActor(operator), days);
}

/**
 * Add campaigns to groups, and set the days they post on where the dialog asked
 * for them.
 *
 * `days` names only the campaigns the operator restricted: one left alone sends
 * nothing and keeps whatever cadence it already has, so a bulk add never quietly
 * undoes a restriction made elsewhere. All seven days is not a restriction but
 * the absence of one -- the bot leaves such a group out of `weekly` entirely,
 * and a stale entry listing every day would still count the group as weekly-only
 * on the campaigns screen -- so it clears the entry instead of writing it.
 */
async function assignGroupCampaigns(
  groupIds: string[], campaignIds: string[], bulk: boolean, by: string, days?: CampaignDays,
): Promise<GroupAssignmentOutcome> {
  if (!WRITES_ENABLED) return READ_ONLY_OUTCOME;
  if (!Array.isArray(groupIds) || groupIds.length === 0 ||
    groupIds.some((jid) => typeof jid !== "string" || !/^\d+(?:-\d+)?@g\.us$/.test(jid))) {
    return { ok: false, detail: "No valid group was named." };
  }
  const jids = [...new Set(groupIds)];
  if (jids.length > MAX_GROUPS_PER_ASSIGNMENT) {
    return { ok: false, detail: `Select up to ${MAX_GROUPS_PER_ASSIGNMENT} groups at a time.` };
  }
  if (!Array.isArray(campaignIds) || campaignIds.length === 0 ||
    campaignIds.some((slug) => typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(slug))) {
    return { ok: false, detail: "No valid campaign was named." };
  }
  const slugs = [...new Set(campaignIds)];
  const badDays = campaignDaysProblem(days, slugs);
  if (badDays) return { ok: false, detail: badDays };
  const schedules = Object.entries(days ?? {});
  const refreshAssignments = () => refreshAssignment(slugs);

  let attemptedWrite = false;
  let legacyProgress: { confirmed: number; jid: string } | undefined;
  try {
    const { groups, context } = await getGroups(undefined, bulk ? { fresh: true, jids } : { fresh: true, jid: jids[0] });
    // The fresh group read already loads and validates the campaign documents.
    // Reuse that vocabulary instead of looking up the same campaign again.
    const [writes, knownCampaigns] = context
      ? [context.writes, context.campaigns]
      : await Promise.all([
        getCapabilities({ fresh: true }),
        Promise.all(slugs.map((slug) => getCampaignState(slug, { fresh: true }))),
      ]);
    // Days are written as `weekly`, which an older bot's writer may not accept.
    // Asking for it only when days were chosen keeps a plain add working there.
    const gate = canWrite(WRITES_ENABLED, writes, "groups", "promos",
      ...(schedules.length > 0 ? ["weekly"] : []));
    if (!gate.allowed) return { ok: false, detail: gate.reason };
    const knownSlugs = new Set(knownCampaigns.map((campaign) => campaign?.slug));
    const missingCampaign = slugs.find((slug) => !knownSlugs.has(slug));
    if (missingCampaign) {
      return { ok: false, detail: bulk ? `Campaign ${missingCampaign} is no longer on record.` : "This campaign is no longer on record." };
    }

    const byId = new Map(groups.map((group) => [group.jid, group]));
    const changes: GroupBatchChange[] = [];
    for (const jid of jids) {
      const current = byId.get(jid);
      if (!current) {
        return { ok: false, detail: bulk ? `Group ${jid} is no longer on record.` : "This group is no longer on record." };
      }
      const additions = slugs.filter((slug) => !current.promos.includes(slug));
      if (current.status !== "active" && (bulk || additions.length > 0 || schedules.length > 0)) {
        const label = bulk ? `${confirmLabel(current)} (${jid})` : "This group";
        return { ok: false, detail: `${label} is ${current.status}, so it cannot be added to a campaign.` };
      }
      const fields: Record<string, unknown> = {};
      if (additions.length > 0) fields.promos = [...current.promos, ...additions];
      // Only touched when days were chosen: an older bot may not report `weekly`
      // at all, and a plain add must not start writing one on its own.
      const currentWeekly = current.weekly ?? {};
      if (schedules.length > 0) {
        const weekly = { ...currentWeekly };
        for (const [slug, chosen] of schedules) {
          if (isEveryDay(chosen)) delete weekly[slug];
          else weekly[slug] = weekdayTokens(chosen);
        }
        if (JSON.stringify(weekly) !== JSON.stringify(currentWeekly)) fields.weekly = weekly;
      }
      if (Object.keys(fields).length > 0) {
        const values: Record<string, unknown> = { promos: current.promos, weekly: currentWeekly };
        changes.push({ id: jid, fields,
          expected: Object.fromEntries(Object.keys(fields).map((field) => [field, values[field]])) });
      }
    }

    if (changes.length > 0) {
      attemptedWrite = true;
      if (!await updateGroupBatch(changes, { by })) {
        attemptedWrite = false;
        for (const { id, fields } of changes) {
          await updateGroup(id, fields, { by, dryRun: true });
        }
        let confirmed = jids.length - changes.length;
        for (const { id, fields } of changes) {
          legacyProgress = { confirmed, jid: id };
          attemptedWrite = true;
          await updateGroup(id, fields, { by });
          confirmed += 1;
        }
      }
    }
  } catch (error) {
    if (bulk && attemptedWrite) refreshAssignments();
    const outcome = failedWrite(error);
    if (!bulk || !attemptedWrite || outcome.ok) return outcome;
    return {
      ...outcome,
      refreshLive: true,
      detail: legacyProgress
        ? `Confirmed assignments for ${legacyProgress.confirmed} of ${jids.length} groups. Stopped at ${legacyProgress.jid}. ${outcome.detail}`
        : outcome.detail,
    };
  }

  // Refresh even if another operator already added it, so the row catches up.
  refreshAssignments();
  return { ok: true };
}

/**
 * Take one campaign off one group, from the chip in the groups table.
 *
 * The write clears the campaign from `promos`, `paused_promos` and `weekly`
 * together: the bot refuses a removal that leaves a pause or a cadence naming a
 * campaign the group is no longer in. `planAssignmentWrites` already works that
 * out for the campaign page's Apply, so the arithmetic is shared rather than
 * written a second time and kept in step by hand.
 *
 * Unlike adding, this does not ask whether the group is active. The bot refuses
 * to add an on-hold group to a campaign; taking one out is always allowed, and
 * an on-hold group still sitting in a campaign is exactly what an operator
 * would want to fix.
 */
export async function removeGroupCampaignAction(jid: string, slug: string): Promise<WriteOutcome> {
  const operator = await requireOperator();
  if (!WRITES_ENABLED) return READ_ONLY_OUTCOME;
  if (typeof jid !== "string" || !/^\d+(?:-\d+)?@g\.us$/.test(jid)) {
    return { ok: false, detail: "No valid group was named." };
  }
  if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return { ok: false, detail: "No valid campaign was named." };
  }

  try {
    const { groups, context } = await getGroups(undefined, { fresh: true, jid });
    const writes = context ? context.writes : await getCapabilities({ fresh: true });
    const gate = canWrite(WRITES_ENABLED, writes, "groups", "promos", "paused_promos", "weekly");
    if (!gate.allowed) return { ok: false, detail: gate.reason };

    const current = groups.find((group) => group.jid === jid);
    if (!current) return { ok: false, detail: "This group is no longer on record." };

    const plan = planAssignmentWrites(slug, { version: 1, added: [], removed: [jid], paused: [] }, groups);
    const write = plan.writes[0];
    // Nothing to write means the campaign is already off the group -- another
    // operator, or a second click on a chip the refresh has yet to take away.
    // That is the wanted state, so it refreshes rather than reporting a failure.
    if (write) {
      const values: Record<string, unknown> = {
        promos: current.promos, weekly: current.weekly, paused_promos: current.pausedPromos ?? [],
      };
      const change = {
        id: jid,
        fields: write.fields,
        expected: Object.fromEntries(Object.keys(write.fields).map((field) => [field, values[field]])),
      };
      if (!await updateGroupBatch([change], { by: auditActor(operator) })) {
        await updateGroup(jid, write.fields, { by: auditActor(operator), dryRun: true });
        await updateGroup(jid, write.fields, { by: auditActor(operator) });
      }
    }
  } catch (error) {
    return failedWrite(error);
  }

  refreshAssignment([slug]);
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
  const operator = await requireOperator();
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
    await updateGroup(jid, change, { by: auditActor(operator) });
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
  const operator = await requireOperator();
  if (!WRITES_ENABLED) return READ_ONLY_OUTCOME;
  if (!jid) return { ok: false, detail: "No group was named." };
  // A bare reason is the shape this took before there was anything else to ask
  // for; keeping it means an older caller cannot silently lose its reason.
  const { reason, leave = false, clearRecords = false, account } =
    typeof options === "string" ? { reason: options } as DeleteGroupOptions : options;
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length > 500) return { ok: false, detail: "The reason must be 500 characters or fewer." };

  try {
    await deleteGroup(jid, { by: auditActor(operator), ...(why ? { reason: why } : {}) });
  } catch (error) {
    return failedWrite(error);
  }

  const warnings: string[] = [];
  if (leave || clearRecords) {
    try {
      const result = await groupAction(jid, {
        leave, clearRecords, account, by: auditActor(operator),
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
  const operator = await requireOperator();
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
    await updateGroup(jid, newGroupFromDiscovered(found), { by: auditActor(operator) });
  } catch (error) {
    return failedWrite(error);
  }
  refresh();
  return { ok: true };
}

export async function removeDiscoveredGroupAction(
  jid: string,
  observedThrough: string,
): Promise<WriteOutcome & { refreshLive?: boolean }> {
  const operator = await requireOperator();
  if (!WRITES_ENABLED) return READ_ONLY_OUTCOME;
  if (typeof jid !== "string" || jid.length > 128 || !/^\d+(?:-\d+)?@g\.us$/.test(jid)) {
    return { ok: false, detail: "No valid group was named." };
  }
  if (typeof observedThrough !== "string" || observedThrough.length > 40 || !Number.isFinite(Date.parse(observedThrough))) {
    return { ok: false, detail: "The discovery observation time is invalid." };
  }
  try {
    const { groups, context } = await getGroups(undefined, { fresh: true, jid });
    if (groups.some(entry => entry.jid === jid)) {
      return { ok: false, detail: "This group has been added to the bot.", refreshLive: true };
    }
    const gate = canAct(WRITES_ENABLED, context?.actions, "removeDiscovery");
    if (!gate.allowed) return { ok: false, detail: gate.reason };
    await removeGroupDiscovery(jid, observedThrough);
  } catch (error) {
    const outcome = failedWrite(error);
    return error instanceof WriteRefusedError && error.status === 409
      ? { ...outcome, refreshLive: true }
      : outcome;
  }
  revalidatePath("/groups");
  return { ok: true };
}
