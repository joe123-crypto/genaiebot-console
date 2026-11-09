"use server";

import { revalidatePath } from "next/cache";
import { OPERATOR_NAME, WRITES_ENABLED } from "@/src/config";
import {
  BotUnavailableError,
  WriteRefusedError,
  WritesDisabledError,
  getCampaignPreview,
  getCampaigns,
  getGroups,
  updateCampaign,
  updateCampaignCaptions,
  updateGroup,
} from "@/src/lib/bot-client";
import {
  draftedJids,
  parseGroupDraft,
  planAssignmentWrites,
  type CampaignGroupDraft,
} from "@/src/lib/campaign-group-draft";
import { READ_ONLY_OUTCOME, failedWrite, type WriteOutcome } from "@/src/lib/write-outcome";
import { READ_ONLY_REASON } from "@/src/lib/write-capabilities";

/**
 * Every action here is guarded twice: in the UI, and again here. A server
 * action is a reachable POST whether or not a button for it is rendered, and
 * with no login in front of the console this check is the only one there is.
 */

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

function refreshCampaign(slug: string) {
  revalidatePath(`/campaigns/${slug}`);
  revalidatePath("/campaigns");
  revalidatePath("/groups");
  revalidatePath("/");
}

export type SaveCaptionsOutcome = { ok: true } | { ok: false; detail: string };

export async function saveCaptionsAction(
  slug: string,
  captions: string[],
  expectedCaptions: string[],
): Promise<SaveCaptionsOutcome> {
  if (!WRITES_ENABLED) return { ok: false, detail: "The console is in read-only mode." };
  if (typeof slug !== "string" || !SLUG.test(slug)) {
    return { ok: false, detail: "No valid campaign was named." };
  }
  if (!Array.isArray(captions) || captions.length === 0 ||
      captions.some((caption) => typeof caption !== "string" || !caption.trim())) {
    return { ok: false, detail: "Keep at least one variant and enter text for every caption." };
  }
  // The bot's write bridge accepts at most 64 KiB, including request metadata.
  if (Buffer.byteLength(JSON.stringify(captions), "utf8") > 60 * 1024) {
    return { ok: false, detail: "The captions are too large to save. Shorten them and try again." };
  }

  try {
    const current = await getCampaignPreview(slug, undefined, { fresh: true });
    if (JSON.stringify(current.captions) !== JSON.stringify(expectedCaptions)) {
      return { ok: false, detail: "Captions changed since you started editing. Reset to the latest captions before saving." };
    }
    await updateCampaignCaptions(slug, captions, { by: OPERATOR_NAME });
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
 * Every write is dry-run first: if the bot would refuse any of them, none is
 * made, and the page names each group and why. Only then are they committed,
 * one group at a time.
 */
export async function applyCampaignGroupsAction(
  slug: string,
  draft: CampaignGroupDraft,
): Promise<ApplyGroupsOutcome> {
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
  try {
    const { groups } = await getGroups(undefined, { fresh: true });
    plan = planAssignmentWrites(slug, staged, groups);
  } catch (error) {
    return stopped(error, null, []);
  }
  const done = [...plan.absorbed];
  if (plan.failures.length > 0) {
    return { ok: false, done, detail: "Nothing was changed.", failures: plan.failures };
  }

  const refused: GroupFailure[] = [];
  for (const write of plan.writes) {
    try {
      await updateGroup(write.jid, write.fields, { by: OPERATOR_NAME, dryRun: true });
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
      await updateGroup(write.jid, write.fields, { by: OPERATOR_NAME });
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
  if (!WRITES_ENABLED) return READ_ONLY_OUTCOME;
  if (typeof slug !== "string" || !SLUG.test(slug)) {
    return { ok: false, detail: "No valid campaign was named." };
  }
  if (typeof enabled !== "boolean") return { ok: false, detail: "The change could not be read." };
  try {
    const campaign = (await getCampaigns(undefined, { fresh: true })).find((entry) => entry.slug === slug);
    if (!campaign) return { ok: false, detail: "This campaign is no longer on record." };
    if ((campaign.storeEnabled ?? campaign.enabled) === enabled) return { ok: true };
    await updateCampaign(slug, { enabled }, { by: OPERATOR_NAME });
  } catch (error) {
    return failedWrite(error);
  }
  refreshCampaign(slug);
  return { ok: true };
}
