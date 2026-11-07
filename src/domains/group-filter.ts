/**
 * Narrowing the Groups table: what an operator searched for, which facet they
 * picked, and which rows survive it.
 *
 * Pure on purpose, and deliberately free of `@/src/lib/bot-client`. The Groups
 * table is a client component — the filter reruns on every keystroke — so
 * everything it recomputes has to be reachable from the browser bundle, which
 * the bot adapters (`node:child_process`) are not. `src/domains/console`
 * re-exports all of it, exactly as it does for `src/domains/schedule`.
 *
 * Filtering happens here rather than on the bot because the read bridge takes
 * no query parameter but `date` and returns the whole payload anyway: the page
 * already holds every row, so narrowing them in the browser costs one pass and
 * keeps typing instant.
 */

import { campaignTitle, shortJid } from "@/src/lib/format";
import type { ActivityTier, Group, GroupStatus } from "@/src/lib/types";

/** The three bands the Groups page used to render as separate cards. They are
 *  disjoint and exhaustive, which is what lets one flat table replace them. */
export type GroupView = "all" | "needs-decision" | "advertising" | "no-campaign";

/** One control, one URL parameter. A view asks about the band a group is in; a
 *  `GroupStatus` asks about the status itself, and "on hold" and "admins only"
 *  are both "needs a decision" without being the same answer. */
export type StatusChoice = GroupView | GroupStatus;

export type GroupFilter = {
  /** Raw, as typed. Trimming happens at match time so a trailing space while
   *  typing a second word does not blank the table. */
  q: string;
  status: StatusChoice;
  /** An account id, or "" for every line. The same holds for the two below. */
  line: string;
  campaign: string;
  tier: string;
};

export const DEFAULT_GROUP_FILTER: GroupFilter = {
  q: "",
  status: "all",
  line: "",
  campaign: "",
  tier: "",
};

export const GROUP_FILTER_KEYS = ["q", "status", "line", "campaign", "tier"] as const;

export const GROUP_VIEW_LABEL: Record<GroupView, string> = {
  all: "All groups",
  "needs-decision": "Needs a decision",
  advertising: "Advertising",
  "no-campaign": "Active, in no campaign",
};

/** Spelled out rather than derived, so an unknown status from a newer bot is
 *  rejected by `parseGroupFilter` instead of becoming an option that matches
 *  nothing. `ui.tsx` owns how these are labelled on screen. */
const GROUP_STATUSES: GroupStatus[] = ["active", "on-hold", "admin-only", "not-a-member"];

const STATUS_CHOICES = new Set<string>([
  ...(Object.keys(GROUP_VIEW_LABEL) as GroupView[]),
  ...GROUP_STATUSES,
]);

/** The tiers the bot defines. A row carrying something else still gets an
 *  option, so a tier this console has not heard of cannot hide its groups. */
const ACTIVITY_TIERS: ActivityTier[] = ["busy", "normal", "quiet"];

/**
 * Anything not advertising right now is what an operator has to decide about.
 *
 * The Groups table's "Needs a decision" view uses this and the sidebar badge
 * counts it; they used to ask the question differently and disagreed by the
 * groups the bot has left, so the badge said 9 while the card listed 12.
 */
export function needsDecision(group: Pick<Group, "status">) {
  return group.status !== "active";
}

export function isAdvertising(group: Pick<Group, "status" | "promos">) {
  return group.status === "active" && group.promos.length > 0;
}

export function isIdle(group: Pick<Group, "status" | "promos">) {
  return group.status === "active" && group.promos.length === 0;
}

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * Tolerant by design. A hand-edited or truncated URL should land on a usable
 * table rather than an empty one, so an unreadable `status` falls back to "all".
 *
 * `line`, `campaign` and `tier` are deliberately NOT checked against the rows:
 * the filter is parsed on the server before the groups are known to the client,
 * and a shared link must survive a value whose groups have since gone. The
 * facet builders surface an orphaned selection instead of silently dropping it.
 */
export function parseGroupFilter(
  params: Record<string, string | string[] | undefined> | URLSearchParams,
): GroupFilter {
  const read = (key: string) =>
    params instanceof URLSearchParams ? params.get(key) ?? "" : firstValue(params[key]);

  const status = read("status");

  return {
    q: read("q"),
    status: STATUS_CHOICES.has(status) ? (status as StatusChoice) : "all",
    line: read("line"),
    campaign: read("campaign"),
    tier: read("tier"),
  };
}

/** Non-default keys only, so an unfiltered table has a clean URL to share. */
export function groupFilterQuery(filter: GroupFilter): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of GROUP_FILTER_KEYS) {
    const value = filter[key];
    if (value !== DEFAULT_GROUP_FILTER[key]) params.set(key, value);
  }
  return params;
}

export function isDefaultGroupFilter(filter: GroupFilter) {
  return GROUP_FILTER_KEYS.every((key) => filter[key] === DEFAULT_GROUP_FILTER[key]);
}

/**
 * What a search matches against.
 *
 * Both forms of the jid are in it, so a jid pasted whole from a log matches and
 * so do the bare digits an operator reads off a row. The literal "unnamed
 * group" is there because dozens of rows have no name and render as exactly
 * that: without it, the one label on screen would be the one thing unsearchable.
 */
export function groupHaystack(group: Pick<Group, "name" | "jid">) {
  const name = group.name?.trim() ?? "";
  return [name || "Unnamed group", group.jid, shortJid(group.jid)].join(" ").toLowerCase();
}

/** Substring, never a regular expression, so a jid's dots stay inert. */
export function matchesGroupQuery(group: Pick<Group, "name" | "jid">, query: string) {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return true;
  return groupHaystack(group).includes(wanted);
}

function matchesStatus(group: Group, status: StatusChoice) {
  switch (status) {
    case "all":
      return true;
    case "needs-decision":
      return needsDecision(group);
    case "advertising":
      return isAdvertising(group);
    case "no-campaign":
      return isIdle(group);
    default:
      return group.status === status;
  }
}

/** Every filter ANDs. The cheap predicates run before the haystack is built. */
export function filterGroups(groups: Group[], filter: GroupFilter) {
  return groups.filter(
    (group) =>
      matchesStatus(group, filter.status) &&
      (!filter.line || group.account === filter.line) &&
      (!filter.campaign || group.promos.includes(filter.campaign)) &&
      (!filter.tier || group.activity === filter.tier) &&
      matchesGroupQuery(group, filter.q),
  );
}

function band(group: Group) {
  if (needsDecision(group)) return 0;
  if (isAdvertising(group)) return 1;
  return 2;
}

/**
 * Needs a decision first, then advertising, then the active groups nothing
 * targets — the order the three cards were read in, kept so that replacing them
 * with one table changes what an operator can do and not what they see first.
 *
 * Rank only: `sort` is stable, so rows within a band keep the order the bot
 * sent them, identically on the server and in the browser.
 */
export function sortGroupsForTable(groups: Group[]) {
  return [...groups].sort((a, b) => band(a) - band(b));
}

export type FacetOption = { value: string; label: string; stale?: boolean };

/** Codepoint order, not `localeCompare`: the server and the browser must agree
 *  on the option order exactly or the first render mismatches. */
function byValue(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A selection whose groups are gone — the line was renamed, the campaign
 *  retired, the row deleted — stays in the list and says so. Dropping it would
 *  leave the select showing its first option while the table filtered by
 *  something else entirely. */
function withSelection(options: FacetOption[], selected: string, label: (value: string) => string) {
  if (!selected || options.some((option) => option.value === selected)) return options;
  return [...options, { value: selected, label: label(selected), stale: true }];
}

export function lineOptions(groups: Group[], selected: string): FacetOption[] {
  const lines = [...new Set(groups.map((group) => group.account).filter(Boolean))].sort(byValue);
  return withSelection(
    lines.map((line) => ({ value: line, label: line })),
    selected,
    (value) => `${value} (no groups)`,
  );
}

export function tierOptions(groups: Group[], selected: string): FacetOption[] {
  const seen = new Set<string>([...ACTIVITY_TIERS, ...groups.map((group) => group.activity)]);
  const tiers = [...seen].filter(Boolean).sort(byValue);
  return withSelection(
    tiers.map((tier) => ({ value: tier, label: tier })),
    selected,
    (value) => `${value} (no groups)`,
  );
}

/**
 * Every campaign any group is configured for, switched-off ones included.
 *
 * `promos` is intent and deliberately keeps a campaign the manifest has turned
 * off, so leaving those out of the list would make their groups unreachable
 * from here. The option says "(off)" for the same reason the row's tag is
 * struck through: so the filter cannot be read as a claim that it posts.
 */
export function campaignOptions(
  groups: Group[],
  disabledPromos: string[],
  selected: string,
): FacetOption[] {
  const off = new Set(disabledPromos);
  const label = (slug: string) => `${campaignTitle(slug)}${off.has(slug) ? " (off)" : ""}`;
  const slugs = [...new Set(groups.flatMap((group) => group.promos))].sort(byValue);
  return withSelection(
    slugs.map((slug) => ({ value: slug, label: label(slug) })),
    selected,
    (value) => `${label(value)} (no groups)`,
  );
}
