import type { Group, PreviewRow } from "@/src/lib/types";

export type KnownCampaignGroup = Pick<Group, "jid" | "name" | "account" | "status">;
export type CampaignGroupRow = Omit<PreviewRow, "caption" | "cap">;

export type CampaignGroupDraft = {
  version: 1;
  added: string[];
  removed: string[];
  paused: string[];
};

export function emptyGroupDraft(): CampaignGroupDraft {
  return { version: 1, added: [], removed: [], paused: [] };
}

export function groupDraftKey(slug: string) {
  return `genaie:campaign-groups:v1:${slug}`;
}

export function hasGroupDraft(draft: CampaignGroupDraft) {
  return draft.added.length + draft.removed.length + draft.paused.length > 0;
}

/** Treat browser storage as untrusted, including drafts from older versions. */
export function parseGroupDraft(raw: string): CampaignGroupDraft {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1) {
    throw new Error("Unknown group draft version");
  }
  const draft = value as Record<string, unknown>;
  for (const key of ["added", "removed", "paused"] as const) {
    if (!Array.isArray(draft[key]) || draft[key].some((jid) => typeof jid !== "string" || !jid.trim())) {
      throw new Error("Invalid group draft");
    }
  }
  return {
    version: 1,
    added: [...new Set(draft.added as string[])],
    removed: [...new Set(draft.removed as string[])],
    paused: [...new Set(draft.paused as string[])],
  };
}

/** Store intent as deltas so fresh live targets are never replaced by a snapshot. */
export function reconcileGroupDraft(
  draft: CampaignGroupDraft,
  live: CampaignGroupRow[],
  known: KnownCampaignGroup[],
): { draft: CampaignGroupDraft; droppedAdditions: number } {
  const liveIds = new Set(live.map((group) => group.jid));
  const activeIds = new Set(known.filter((group) => group.status === "active").map((group) => group.jid));
  const removed = draft.removed.filter((jid) => liveIds.has(jid));
  const removedIds = new Set(removed);
  const added = draft.added.filter((jid) => !liveIds.has(jid) && activeIds.has(jid));
  const targets = new Set([...liveIds, ...added].filter((jid) => !removedIds.has(jid)));
  const next: CampaignGroupDraft = {
    version: 1, added, removed, paused: draft.paused.filter((jid) => targets.has(jid)),
  };
  return {
    draft: JSON.stringify(next) === JSON.stringify(draft) ? draft : next,
    droppedAdditions: draft.added.filter((jid) => !liveIds.has(jid) && !activeIds.has(jid)).length,
  };
}
