"use server";

import { requireOperator, auditActor } from "@/src/lib/auth";

import { revalidatePath } from "next/cache";
import { WRITES_ENABLED } from "@/src/config";
import {
  BotUnavailableError,
  WriteRefusedError,
  WritesDisabledError,
  getCampaignPayload,
  getCampaignPreview,
  getCampaignState,
  getOverview,
  getCapabilities,
  deleteCampaign,
  getGroups,
  updateCampaign,
  updateCampaignCaptions,
  updateGroup,
  updateGroupBatch,
} from "@/src/lib/bot-client";
import {
  draftedJids,
  parseGroupDraft,
  planAssignmentWrites,
  type CampaignGroupDraft,
} from "@/src/lib/campaign-group-draft";
import { trackingError, sameTracking } from "@/src/lib/tracked-caption-link";
import { canWrite } from "@/src/lib/write-capabilities";
import type { Tracking } from "@/src/lib/types";
import { READ_ONLY_OUTCOME, failedWrite, type WriteOutcome } from "@/src/lib/write-outcome";
import { canDeleteCampaign, READ_ONLY_REASON } from "@/src/lib/write-capabilities";

/**
 * Every action here is guarded twice: in the UI, and again here. A server
 * action is a reachable POST whether or not a button is rendered. Session
 * verification runs before the independent write gates and bot validation.
 */

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export async function deleteCampaignAction(slug: string): Promise<WriteOutcome> {
  const operator = await requireOperator();
  if (!WRITES_ENABLED) return READ_ONLY_OUTCOME;
  if (typeof slug !== "string" || !SLUG.test(slug) || slug.length > 64 || slug === "new") {
    return { ok: false, detail: "No valid campaign was named." };
  }
  try {
    const overview = await getOverview(undefined, { fresh: true });
    const gate = canDeleteCampaign(WRITES_ENABLED, overview.writes);
    if (!gate.allowed) return { ok: false, detail: gate.reason };
    await deleteCampaign(slug, { by: auditActor(operator) });
  } catch (error) {
    return failedWrite(error);
  }
  refreshCampaign(slug);
  revalidatePath("/schedule");
  return { ok: true };
}

function refreshCampaign(slug: string) {
  revalidatePath(`/campaigns/${slug}`);
  revalidatePath("/campaigns");
  revalidatePath("/groups");
  revalidatePath("/");
}

export type SaveCaptionsOutcome = { ok: true } | { ok: false; detail: string; latestCaptions?: string[]; latestTracking?: Tracking };

export async function saveCaptionsAction(
  slug: string,
  captions: string[],
  expectedCaptions: string[],
  trackingChange?: { tracking: Tracking; expectedTracking: Tracking },
): Promise<SaveCaptionsOutcome> {
  const operator = await requireOperator();
  if (!WRITES_ENABLED) return { ok: false, detail: "The console is in read-only mode." };
  if (typeof slug !== "string" || !SLUG.test(slug)) {
    return { ok: false, detail: "No valid campaign was named." };
  }
  if (!Array.isArray(captions) || captions.length === 0 ||
      captions.some((caption) => typeof caption !== "string" || !caption.trim())) {
    return { ok: false, detail: "Keep at least one variant and enter text for every caption." };
  }
  if (!Array.isArray(expectedCaptions) || expectedCaptions.some((caption) => typeof caption !== "string")) {
    return { ok: false, detail: "The original captions could not be read. Reload the editor before saving." };
  }
  // The bot's own validator caps captions at 60 KiB; the gateway envelope
  // around them is 64 KiB. Check the limit that governs, not the envelope.
  if (Buffer.byteLength(JSON.stringify(captions), "utf8") > 60 * 1024) {
    return { ok: false, detail: "The captions are too large to save. Shorten them and try again." };
  }

  try {
    if (trackingChange) {
      const invalid = trackingError(trackingChange.tracking) || trackingError(trackingChange.expectedTracking);
      if (invalid) return { ok: false, detail: invalid };
      const gate = canWrite(WRITES_ENABLED, await getCapabilities(), "campaigns", "captions", "tracking");
      if (!gate.allowed) return { ok: false, detail: gate.reason };
    }
    // The bot's captions read does not carry the campaign's tracking (it
    // reports none, or `{}`), so the baseline is checked against the campaign
    // record -- the same source the editor took it from when it loaded.
    const [current, record] = await Promise.all([
      getCampaignPreview(slug, undefined, { fresh: true, captionsOnly: true }),
      trackingChange ? getCampaignPayload(slug, undefined, { fresh: true }).then(({ campaign }) => campaign) : null,
    ]);
    const latestTracking = record ? record.tracking ?? {} : undefined;
    if (trackingChange && (latestTracking === undefined || !sameTracking(latestTracking, trackingChange.expectedTracking))) {
      return { ok: false, detail: "Campaign tracking changed since you started editing. Reset to the latest settings before saving.", latestCaptions: current.captions, latestTracking };
    }
    if (JSON.stringify(current.captions) !== JSON.stringify(expectedCaptions)) {
      return { ok: false, detail: "Captions changed since you started editing. Reset to the latest captions before saving.", latestCaptions: current.captions, ...(trackingChange ? { latestTracking } : {}) };
    }
    if (trackingChange) await updateCampaign(slug, { captions, tracking: trackingChange.tracking }, { by: auditActor(operator) });
    else await updateCampaignCaptions(slug, captions, { by: auditActor(operator) });
  } catch (error) {
    if (error instanceof BotUnavailableError || error instanceof WritesDisabledError) {
      return { ok: false, detail: error.detail };
    }
    throw error;
  }

  revalidatePath(`/campaigns/${slug}`);
  revalidatePath("/campaigns");
  revalidatePath("/");
  return { ok: true };
}

/* ------------------------------------------------------ where it goes -- */

export type GroupFailure = { jid: string; detail: string; problems?: string[] };

/**
 * `done` lists every group whose part of the draft is now true on the bot --
 * written by this call, or already so -- and is what the page takes out of the
 * draft. It is filled in on failure too, so a run that stops half way leaves
 * exactly the unapplied groups staged.
 */
export type ApplyGroupsOutcome =
  | { ok: true; done: string[] }
  | { ok: false; done: string[]; detail: string; failures?: GroupFailure[] };

/** More than this in one go is far beyond any real edit, and each group is a
 *  separate round trip to the bot -- twice, with the dry run. */
const MAX_GROUPS_PER_APPLY = 100;

function stopped(error: unknown, jid: string | null, done: string[], detail?: string): ApplyGroupsOutcome {
  const outcome = failedWrite(error) as Extract<WriteOutcome, { ok: false }>;
  return {
    ok: false,
    done,
    detail: detail ? `${detail} ${outcome.detail}` : outcome.detail,
    ...(jid ? { failures: [{ jid, detail: outcome.detail, ...(outcome.problems ? { problems: outcome.problems } : {}) }] } : {}),
  };
}

/**
 * Send a campaign's staged "where it goes" changes to the bot.
 *
 * Each group's new lists are worked out from its record as the bot has it now,
 * so a change made elsewhere since the page loaded is kept, not overwritten.
 * A supporting bot validates and commits the changed groups together against
 * one transactional snapshot. Older bots retain the dry-run/per-group path.
 */
export async function applyCampaignGroupsAction(
  slug: string,
  draft: CampaignGroupDraft,
): Promise<ApplyGroupsOutcome> {
  const operator = await requireOperator();
  if (!WRITES_ENABLED) return { ok: false, done: [], detail: READ_ONLY_REASON };
  if (typeof slug !== "string" || !SLUG.test(slug)) {
    return { ok: false, done: [], detail: "No valid campaign was named." };
  }
  let staged: CampaignGroupDraft;
  try {
    // The draft comes from browser storage: read it exactly as the page does.
    staged = parseGroupDraft(JSON.stringify(draft));
  } catch {
    return { ok: false, done: [], detail: "The draft could not be read." };
  }
  const jids = draftedJids(staged);
  if (jids.length === 0) return { ok: true, done: [] };
  if (jids.length > MAX_GROUPS_PER_APPLY) {
    return { ok: false, done: [], detail: `Apply at most ${MAX_GROUPS_PER_APPLY} groups at a time.` };
  }
  if (jids.some((jid) => !jid.endsWith("@g.us"))) {
    return { ok: false, done: [], detail: "The draft names something that is not a group." };
  }

  let plan;
  let expectedGroups;
  try {
    const { groups } = await getGroups(undefined, { fresh: true, jids });
    expectedGroups = new Map(groups.map((group) => [group.jid, group]));
    plan = planAssignmentWrites(slug, staged, groups);
  } catch (error) {
    return stopped(error, null, []);
  }
  const done = [...plan.absorbed];
  if (plan.failures.length > 0) {
    return { ok: false, done, detail: "Nothing was changed.", failures: plan.failures };
  }

  if (plan.writes.length > 0) {
    try {
      const result = await updateGroupBatch(plan.writes.map(({ jid, fields }) => {
        const group = expectedGroups.get(jid)!;
        const values: Record<string, unknown> = { promos: group.promos, weekly: group.weekly, paused_promos: group.pausedPromos ?? [] };
        return { id: jid, fields, expected: Object.fromEntries(Object.keys(fields).map((key) => [key, values[key]])) };
      }), { by: auditActor(operator) });
      if (result) {
        refreshCampaign(slug);
        return { ok: true, done: [...done, ...result.done] };
      }
    } catch (error) {
      refreshCampaign(slug);
      return stopped(error, null, done);
    }
  }

  const refused: GroupFailure[] = [];
  for (const write of plan.writes) {
    try {
      await updateGroup(write.jid, write.fields, { by: auditActor(operator), dryRun: true });
    } catch (error) {
      if (!(error instanceof WriteRefusedError)) return stopped(error, write.jid, done, "Nothing was changed.");
      refused.push({ jid: write.jid, detail: error.detail, problems: error.problems });
    }
  }
  if (refused.length > 0) {
    return { ok: false, done, detail: "The bot would refuse part of this draft, so nothing was changed.", failures: refused };
  }

  const before = done.length;
  for (const [index, write] of plan.writes.entries()) {
    try {
      await updateGroup(write.jid, write.fields, { by: auditActor(operator) });
      done.push(write.jid);
    } catch (error) {
      if (done.length > before) refreshCampaign(slug);
      return stopped(error, write.jid, done,
                     `Stopped after ${index} of ${plan.writes.length} groups; the rest are still in the draft.`);
    }
  }
  refreshCampaign(slug);
  return { ok: true, done };
}

/* -------------------------------------------------------- the switch -- */

/**
 * Switch a campaign on or off. This is the operator's switch in Firestore, not
 * the cron: a campaign with no cron registered stays silent whatever it says.
 * Asking for the state it is already in -- another tab got there first -- is a
 * success that writes nothing.
 */
export async function setCampaignEnabledAction(slug: string, enabled: boolean): Promise<WriteOutcome> {
  const operator = await requireOperator();
  if (!WRITES_ENABLED) return READ_ONLY_OUTCOME;
  if (typeof slug !== "string" || !SLUG.test(slug)) {
    return { ok: false, detail: "No valid campaign was named." };
  }
  if (typeof enabled !== "boolean") return { ok: false, detail: "The change could not be read." };
  try {
    const campaign = await getCampaignState(slug, { fresh: true });
    if (!campaign) return { ok: false, detail: "This campaign is no longer on record." };
    if ((campaign.storeEnabled ?? campaign.enabled) === enabled) return { ok: true };
    await updateCampaign(slug, { enabled }, { by: auditActor(operator) });
  } catch (error) {
    return failedWrite(error);
  }
  refreshCampaign(slug);
  return { ok: true };
}
