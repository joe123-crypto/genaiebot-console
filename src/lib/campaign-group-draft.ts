import type { Group, PreviewRow } from "@/src/lib/types";

export type KnownCampaignGroup = Pick<Group, "jid" | "name" | "account" | "status">;
export type CampaignGroupRow = Omit<PreviewRow, "caption" | "cap">;

/**
 * A campaign's "where it goes" edits, staged in the browser until applied.
 *
 * Stored as deltas against the live assignments, so a refresh never replaces
 * fresh live targets with a stale snapshot. `paused` pauses a group for this
 * campaign; `resumed` lifts a pause the bot already has. `resumed` is optional
 * and only stored when non-empty, so every draft saved before live pauses
 * existed reads -- and is written back -- exactly as it was.
 */
export type CampaignGroupDraft = {
  version: 1;
  added: string[];
  removed: string[];
  paused: string[];
  resumed?: string[];
};

export function emptyGroupDraft(): CampaignGroupDraft {
  return { version: 1, added: [], removed: [], paused: [] };
}

export function groupDraftKey(slug: string) {
  return `genaie:campaign-groups:v1:${slug}`;
}

export function hasGroupDraft(draft: CampaignGroupDraft) {
  return draft.added.length + draft.removed.length + draft.paused.length
    + (draft.resumed?.length ?? 0) > 0;
}

function jidList(value: unknown) {
  return Array.isArray(value) && value.every((jid) => typeof jid === "string" && jid.trim());
}

/** Treat browser storage as untrusted, including drafts from older versions. */
export function parseGroupDraft(raw: string): CampaignGroupDraft {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1) {
    throw new Error("Unknown group draft version");
  }
  const draft = value as Record<string, unknown>;
  for (const key of ["added", "removed", "paused"] as const) {
    if (!jidList(draft[key])) throw new Error("Invalid group draft");
  }
  if ("resumed" in draft && !jidList(draft.resumed)) throw new Error("Invalid group draft");
  const parsed: CampaignGroupDraft = {
    version: 1,
    added: [...new Set(draft.added as string[])],
    removed: [...new Set(draft.removed as string[])],
    paused: [...new Set(draft.paused as string[])],
  };
  const resumed = [...new Set((draft.resumed as string[] | undefined) ?? [])];
  if (resumed.length > 0) parsed.resumed = resumed;
  return parsed;
}

/** Store intent as deltas so fresh live targets are never replaced by a snapshot.
 *  A delta the bot already shows -- an assignment made, a pause applied -- is
 *  absorbed rather than kept, so applying a draft empties it. */
export function reconcileGroupDraft(
  draft: CampaignGroupDraft,
  live: CampaignGroupRow[],
  known: KnownCampaignGroup[],
): { draft: CampaignGroupDraft; droppedAdditions: number } {
  const liveIds = new Set(live.map((group) => group.jid));
  const livePaused = new Set(live.filter((group) => group.paused).map((group) => group.jid));
  const activeIds = new Set(known.filter((group) => group.status === "active").map((group) => group.jid));
  const removed = draft.removed.filter((jid) => liveIds.has(jid));
  const removedIds = new Set(removed);
  const added = draft.added.filter((jid) => !liveIds.has(jid) && activeIds.has(jid));
  const targets = new Set([...liveIds, ...added].filter((jid) => !removedIds.has(jid)));
  const next: CampaignGroupDraft = {
    version: 1, added, removed,
    paused: draft.paused.filter((jid) => targets.has(jid) && !livePaused.has(jid)),
  };
  const resumed = (draft.resumed ?? []).filter((jid) => targets.has(jid) && livePaused.has(jid));
  if (resumed.length > 0) next.resumed = resumed;
  return {
    draft: JSON.stringify(next) === JSON.stringify(draft) ? draft : next,
    droppedAdditions: draft.added.filter((jid) => !liveIds.has(jid) && !activeIds.has(jid)).length,
  };
}

/** Whether a row ends up paused once the draft is applied. */
export function isPausedInDraft(draft: CampaignGroupDraft, jid: string, live: CampaignGroupRow | null) {
  if (draft.paused.includes(jid)) return true;
  if (draft.resumed?.includes(jid)) return false;
  return Boolean(live?.paused);
}

/** The draft after one Pause or Resume click on a row. Undoing a staged change
 *  removes it instead of staging its opposite, so the draft stays minimal. */
export function togglePause(draft: CampaignGroupDraft, jid: string, live: CampaignGroupRow | null) {
  const resumed = draft.resumed ?? [];
  const next: CampaignGroupDraft = { ...draft, paused: [...draft.paused] };
  let nextResumed = [...resumed];
  if (isPausedInDraft(draft, jid, live)) {
    if (next.paused.includes(jid)) next.paused = next.paused.filter((entry) => entry !== jid);
    else nextResumed = [...nextResumed, jid];
  } else if (nextResumed.includes(jid)) {
    nextResumed = nextResumed.filter((entry) => entry !== jid);
  } else {
    next.paused = [...next.paused, jid];
  }
  delete next.resumed;
  if (nextResumed.length > 0) next.resumed = nextResumed;
  return next;
}

/** Every group a draft touches, in the order its entries were made. */
export function draftedJids(draft: CampaignGroupDraft) {
  return [...new Set([...draft.added, ...draft.removed, ...draft.paused, ...(draft.resumed ?? [])])];
}

/** A draft with the given groups' entries taken out -- what is left to apply. */
export function withoutJids(draft: CampaignGroupDraft, done: string[]): CampaignGroupDraft {
  const gone = new Set(done);
  const next: CampaignGroupDraft = {
    version: 1,
    added: draft.added.filter((jid) => !gone.has(jid)),
    removed: draft.removed.filter((jid) => !gone.has(jid)),
    paused: draft.paused.filter((jid) => !gone.has(jid)),
  };
  const resumed = (draft.resumed ?? []).filter((jid) => !gone.has(jid));
  if (resumed.length > 0) next.resumed = resumed;
  return next;
}

export type AssignmentWrite = { jid: string; fields: Record<string, unknown> };
export type AssignmentPlan = {
  /** One write per group, carrying every field the draft changes on it. */
  writes: AssignmentWrite[];
  /** Groups already in the state the draft asks for: nothing to send. */
  absorbed: string[];
  /** Groups the draft cannot be applied to, and why. */
  failures: { jid: string; detail: string }[];
};

/**
 * Turn a campaign's draft into writes against the groups as they are NOW.
 *
 * Each group's new lists are computed from its fresh record, not from what the
 * page showed, so another edit made in the meantime is built on rather than
 * overwritten. Removing a campaign clears it from `promos`, `paused_promos` and
 * `weekly` in the same write: the bot refuses a removal that leaves a pause or a
 * cadence naming a campaign the group is no longer in.
 */
export function planAssignmentWrites(
  slug: string,
  draft: CampaignGroupDraft,
  groups: Group[],
): AssignmentPlan {
  const byJid = new Map(groups.map((group) => [group.jid, group]));
  const plan: AssignmentPlan = { writes: [], absorbed: [], failures: [] };
  const added = new Set(draft.added);
  const removed = new Set(draft.removed);
  const paused = new Set(draft.paused);
  const resumed = new Set(draft.resumed ?? []);

  for (const jid of draftedJids(draft)) {
    const group = byJid.get(jid);
    if (!group) {
      plan.failures.push({ jid, detail: "This group is no longer on record." });
      continue;
    }
    const promos = [...group.promos];
    let pausedPromos = [...(group.pausedPromos ?? [])];
    const weekly = { ...group.weekly };
    const fields: Record<string, unknown> = {};

    if (removed.has(jid)) {
      if (promos.includes(slug)) {
        fields.promos = promos.filter((promo) => promo !== slug);
        if (pausedPromos.includes(slug)) {
          fields.paused_promos = pausedPromos.filter((promo) => promo !== slug);
        }
        if (slug in weekly) {
          delete weekly[slug];
          fields.weekly = weekly;
        }
      }
    } else {
      const assigned = promos.includes(slug) || added.has(jid);
      if (added.has(jid) && !promos.includes(slug)) {
        // The page only offers active groups, but the record may have moved on.
        if (group.status !== "active") {
          plan.failures.push({ jid, detail: `This group is ${group.status}, so it cannot be added to a campaign.` });
          continue;
        }
        fields.promos = [...promos, slug];
      }
      if (paused.has(jid)) {
        if (!assigned) {
          plan.failures.push({ jid, detail: "This group is no longer in the campaign, so it cannot be paused for it." });
          continue;
        }
        if (!pausedPromos.includes(slug)) pausedPromos = [...pausedPromos, slug];
      }
      if (resumed.has(jid)) pausedPromos = pausedPromos.filter((promo) => promo !== slug);
      if (JSON.stringify(pausedPromos) !== JSON.stringify(group.pausedPromos ?? [])) {
        fields.paused_promos = pausedPromos;
      }
    }

    if (Object.keys(fields).length === 0) plan.absorbed.push(jid);
    else plan.writes.push({ jid, fields });
  }
  return plan;
}
