import type { Group, GroupContext, Campaign, GroupDiscovery, GroupMetrics, WriteCapabilities } from "./types";
import type { DaySlot } from "@/src/domains/schedule";

export type SyncStatus = { revision: string; syncedAt: string | null; stale: boolean; state: "live" | "syncing" | "stale" | "awaiting-commit" };
export type LiveContext = Omit<GroupContext, "campaigns">;
export type CampaignRow = Omit<Campaign, "captions" | "images" | "assets" | "script"> & { captionCount: number };
export type LiveFacets = { lines: string[]; campaigns: { slug: string; name: string; enabled: boolean }[]; tiers: string[] };
export type LivePage<T> = { rows?: T[]; nextCursor?: string | null; total?: number; revision: string; sync: SyncStatus;
  unchanged?: boolean; reset?: boolean; context?: LiveContext; facets?: LiveFacets; disabledPromos?: string[]; discovery?: GroupDiscovery; deletions?: import("./types").CampaignDeletion[] };
export type LiveSchedule = { sync: SyncStatus; revision: string; unchanged?: boolean; date?: string; timezone?: string; slots?: DaySlot[]; writes?: WriteCapabilities };
export type LiveMetrics = { rows: { jid: string; metrics: GroupMetrics }[]; sync: SyncStatus };
export type { Group };
