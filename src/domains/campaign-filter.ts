/**
 * Narrowing the Campaigns table, and the questions the sidebar asks about a
 * campaign.
 *
 * Ten campaigns fit on one screen, so this is not really about finding a row.
 * It is about the views: which campaigns are switched off, which failed to
 * load, which target nothing. Two of those are already counted in the
 * "Needs attention" card, and the card now links here — so the predicates have
 * to be the same ones `attentionItems` counts with, not a second opinion that
 * can disagree with the number printed beside the link.
 *
 * Pure, and free of the bot adapters, for the reason given in
 * `@/src/domains/group-filter`: the table is a client component.
 */

import {
  facetValues, isDefault, queryFromFilter, readParam, withSelection,
  type FacetOption,
} from "@/src/domains/filter";
import { campaignTitle } from "@/src/lib/format";
import type { Campaign } from "@/src/lib/types";

type CampaignFilterRow = Pick<Campaign, "slug" | "name" | "tracking" | "enabled" | "error" | "targetCount" | "accounts" | "weeklyCount" | "hour">;

/** Views, not statuses: a campaign has no single status field, and what an
 *  operator wants to see is a combination — off, broken, or running but
 *  pointed at nothing. */
export type CampaignStatusChoice = "all" | "running" | "off" | "failing" | "no-groups";

export type CampaignSlotChoice = "" | "morning" | "afternoon" | "evening" | "unscheduled";

export type CampaignFilter = {
  q: string;
  status: CampaignStatusChoice;
  /** An account id, or "" for every line. */
  line: string;
  /** "" | "daily" | "weekly" */
  cadence: string;
  slot: CampaignSlotChoice;
};

export const DEFAULT_CAMPAIGN_FILTER: CampaignFilter = {
  q: "",
  status: "all",
  line: "",
  cadence: "",
  slot: "",
};

export const CAMPAIGN_FILTER_KEYS = ["q", "status", "line", "cadence", "slot"] as const;

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatusChoice, string> = {
  all: "All campaigns",
  running: "Running",
  off: "Switched off",
  failing: "Failing to load",
  "no-groups": "No groups",
};

export const CAMPAIGN_SLOT_LABEL: Record<Exclude<CampaignSlotChoice, "">, string> = {
  morning: "Morning (before 12:00)",
  afternoon: "Afternoon (12:00–16:59)",
  evening: "Evening (17:00 on)",
  unscheduled: "No slot",
};

export const CAMPAIGN_CADENCE_LABEL: Record<string, string> = {
  daily: "Daily everywhere",
  weekly: "Has weekly-only groups",
};

const STATUS_CHOICES = new Set<string>(Object.keys(CAMPAIGN_STATUS_LABEL));
const SLOT_CHOICES = new Set<string>(Object.keys(CAMPAIGN_SLOT_LABEL));
const CADENCE_CHOICES = new Set<string>(Object.keys(CAMPAIGN_CADENCE_LABEL));

/** A campaign that will actually post: declared, parsed and switched on. */
export function isRunning(campaign: Pick<Campaign, "enabled" | "error">) {
  return campaign.enabled && !campaign.error;
}

/** A fault either way. A campaign the manifest switched off can still fail to
 *  load, and that is worth reporting: the copy is broken, not merely paused. */
export function isFailing(campaign: Pick<Campaign, "error">) {
  return Boolean(campaign.error);
}

/**
 * Configured to post and pointed at nothing.
 *
 * Switched-off and broken campaigns are excluded on purpose: one targets
 * nothing because someone meant it to, and the other has already been reported
 * as a load failure, so counting either here would be a second complaint about
 * a decision or a fault already named.
 */
export function hasNoGroups(campaign: Pick<Campaign, "enabled" | "error" | "targetCount">) {
  return isRunning(campaign) && campaign.targetCount === 0;
}

/** Which part of the day a campaign's cron fires in. `unscheduled` is the row
 *  `daySlots` drops for having no readable time — the one place it still has
 *  to be visible, because this screen is where you would notice. */
export function campaignSlotBucket(campaign: Pick<Campaign, "hour">): CampaignSlotChoice {
  if (campaign.hour === null) return "unscheduled";
  if (campaign.hour < 12) return "morning";
  if (campaign.hour < 17) return "afternoon";
  return "evening";
}

/** A campaign posts through several lines at once, so this asks whether one of
 *  them is the line in question — unlike a group, which has exactly one. */
export function usesLine(campaign: Pick<Campaign, "accounts">, line: string) {
  return Object.prototype.hasOwnProperty.call(campaign.accounts, line);
}

export function hasWeeklyGroups(campaign: Pick<Campaign, "weeklyCount">) {
  return campaign.weeklyCount > 0;
}

export function parseCampaignFilter(
  params: Record<string, string | string[] | undefined> | URLSearchParams,
): CampaignFilter {
  const read = (key: string) => readParam(params, key);
  const status = read("status");
  const cadence = read("cadence");
  const slot = read("slot");

  return {
    q: read("q"),
    status: STATUS_CHOICES.has(status) ? (status as CampaignStatusChoice) : "all",
    line: read("line"),
    cadence: CADENCE_CHOICES.has(cadence) ? cadence : "",
    slot: SLOT_CHOICES.has(slot) ? (slot as CampaignSlotChoice) : "",
  };
}

export function campaignFilterQuery(filter: CampaignFilter): URLSearchParams {
  return queryFromFilter(filter, DEFAULT_CAMPAIGN_FILTER, CAMPAIGN_FILTER_KEYS);
}

export function isDefaultCampaignFilter(filter: CampaignFilter) {
  return isDefault(filter, DEFAULT_CAMPAIGN_FILTER, CAMPAIGN_FILTER_KEYS);
}

/** The three things on a row that name it: the title in the link, the id
 *  underneath, and the ref badge an operator reads off a tracked link. */
export function campaignHaystack(campaign: CampaignFilterRow) {
  return [campaignTitle(campaign.slug), campaign.slug, campaign.name, campaign.tracking.prefix ?? ""]
    .join(" ")
    .toLowerCase();
}

/** Substring, never a regular expression. */
export function matchesCampaignQuery(campaign: CampaignFilterRow, query: string) {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return true;
  return campaignHaystack(campaign).includes(wanted);
}

function matchesStatus(campaign: CampaignFilterRow, status: CampaignStatusChoice) {
  switch (status) {
    case "all":
      return true;
    case "running":
      return isRunning(campaign);
    case "off":
      return !campaign.enabled;
    case "failing":
      return isFailing(campaign);
    case "no-groups":
      return hasNoGroups(campaign);
  }
}

/**
 * Every filter ANDs, and the payload's order is preserved.
 *
 * Nothing here sorts: the bridge sends campaigns in the order they run through
 * the day, which is what the screen claims to show, and `daySlots` is no help
 * because it drops exactly the switched-off and unscheduled rows this table
 * exists to surface.
 */
export function filterCampaigns<T extends CampaignFilterRow>(campaigns: T[], filter: CampaignFilter) {
  return campaigns.filter(
    (campaign) =>
      matchesStatus(campaign, filter.status) &&
      (!filter.line || usesLine(campaign, filter.line)) &&
      (!filter.cadence || hasWeeklyGroups(campaign) === (filter.cadence === "weekly")) &&
      (!filter.slot || campaignSlotBucket(campaign) === filter.slot) &&
      matchesCampaignQuery(campaign, filter.q),
  );
}

export function campaignLineOptions(campaigns: CampaignFilterRow[], selected: string): FacetOption[] {
  const lines = facetValues(campaigns.flatMap((campaign) => Object.keys(campaign.accounts)));
  return withSelection(
    lines.map((line) => ({ value: line, label: line })),
    selected,
    (value) => `${value} (no campaigns)`,
  );
}

export function campaignSlotOptions(campaigns: CampaignFilterRow[], selected: string): FacetOption[] {
  const present = new Set(campaigns.map(campaignSlotBucket));
  // Fixed order, because a time of day has one: not alphabetical.
  const order: Exclude<CampaignSlotChoice, "">[] = [
    "morning",
    "afternoon",
    "evening",
    "unscheduled",
  ];
  return withSelection(
    order
      .filter((bucket) => present.has(bucket))
      .map((bucket) => ({ value: bucket, label: CAMPAIGN_SLOT_LABEL[bucket] })),
    selected,
    (value) => `${CAMPAIGN_SLOT_LABEL[value as Exclude<CampaignSlotChoice, "">] ?? value} (none)`,
  );
}

export function campaignCadenceOptions(): FacetOption[] {
  return [
    { value: "daily", label: CAMPAIGN_CADENCE_LABEL.daily },
    { value: "weekly", label: CAMPAIGN_CADENCE_LABEL.weekly },
  ];
}
