import type { CapSettings } from "@/src/lib/types";

/**
 * The cap settings form, and how its fields map to what the bot stores.
 *
 * Every group gets a daily allowance of posts. Its activity tier picks a band,
 * `[low, high]`, and replies to its adverts move the allowance inside that band.
 * A group with no tier of its own falls into the default tier. With caps off,
 * every campaign that targets a group posts there every day.
 *
 * When a group's allowance is smaller than the number of campaigns targeting
 * it, the campaigns take turns: each one sits out in turn, so over a full cycle
 * every one of them posts the same number of times. Switching that off pins the
 * group to the same campaigns every day and the rest stop posting there
 * altogether, which is why it is on unless it was deliberately turned off.
 *
 * The form edits the bands' numbers, not the set of tiers: groups name tiers, so
 * adding or removing one is a different change with consequences for them.
 */

/** What the form holds. Band numbers stay text until they are checked, so a
 *  half-typed value is never silently read as 0. */
export type CapDraft = {
  enabled: boolean;
  rotation: boolean;
  defaultActivity: string;
  bands: Record<string, [string, string]>;
};

/** The change as the bot stores it: `settings/defaults` fields. */
export type CapChange = {
  caps_enabled?: boolean;
  rotation_enabled?: boolean;
  activity?: string;
  bands?: Record<string, [number, number]>;
};

/** Generous: the busiest band in use is 6..10, and one ad a day per campaign
 *  across all of them is about ten. Anything past this is a typo. */
export const MAX_DAILY_CAP = 50;

/** Whether the campaigns take turns, as the bot reports it.
 *
 *  A bot that predates the switch sends no field, and every capped group there
 *  rotates. Read bare, `undefined` would be falsy and the form would open
 *  offering to turn on something already on -- and a save would then ask that
 *  bot for a field it refuses by name. Every read goes through here. */
export function rotates(settings: CapSettings): boolean {
  return settings.rotation ?? true;
}

export function draftFromSettings(settings: CapSettings): CapDraft {
  return {
    enabled: settings.enabled,
    rotation: rotates(settings),
    defaultActivity: settings.defaultActivity,
    bands: Object.fromEntries(Object.entries(settings.bands).map(
      ([tier, [low, high]]) => [tier, [String(low), String(high)]])),
  };
}

/** The same settings in the bot's own field names, for stale checks. */
export function storedSettings(settings: CapSettings): Required<CapChange> {
  return {
    caps_enabled: settings.enabled,
    rotation_enabled: rotates(settings),
    activity: settings.defaultActivity,
    bands: settings.bands,
  };
}

function wholeNumber(text: string) {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
}

/** What is wrong with the form, field by field; empty when it can be saved. */
export function capDraftProblems(draft: CapDraft, settings: CapSettings): string[] {
  const problems: string[] = [];
  const tiers = Object.keys(settings.bands);
  if (!tiers.includes(draft.defaultActivity)) {
    problems.push(`The default tier must be one of ${tiers.join(", ")}.`);
  }
  if (JSON.stringify(Object.keys(draft.bands).sort()) !== JSON.stringify([...tiers].sort())) {
    problems.push("The tiers themselves cannot be changed here.");
    return problems;
  }
  for (const tier of tiers) {
    const [low, high] = draft.bands[tier].map(wholeNumber);
    if (Number.isNaN(low) || Number.isNaN(high)) {
      problems.push(`${tier}: enter whole numbers for both ends of the band.`);
    } else if (low > high) {
      problems.push(`${tier}: the low end cannot be above the high end.`);
    } else if (high > MAX_DAILY_CAP) {
      problems.push(`${tier}: at most ${MAX_DAILY_CAP} posts a day.`);
    }
  }
  return problems;
}

/** Only what the form changed, in the bot's field names. Call it on a draft
 *  without problems: band text is read as numbers here. */
export function capChange(draft: CapDraft, settings: CapSettings): CapChange {
  const change: CapChange = {};
  if (draft.enabled !== settings.enabled) change.caps_enabled = draft.enabled;
  if (draft.rotation !== rotates(settings)) change.rotation_enabled = draft.rotation;
  if (draft.defaultActivity !== settings.defaultActivity) change.activity = draft.defaultActivity;
  const bands = Object.fromEntries(Object.keys(settings.bands).map((tier) => {
    const [low, high] = draft.bands[tier].map(wholeNumber);
    return [tier, [low, high] as [number, number]];
  }));
  // The bot stores the whole map, so any one band moving sends all of them.
  const moved = Object.entries(settings.bands).some(
    ([tier, [low, high]]) => bands[tier][0] !== low || bands[tier][1] !== high);
  if (moved) change.bands = bands;
  return change;
}

/** One line per change, for the confirmation. */
export function describeCapChange(change: CapChange, settings: CapSettings): string[] {
  const lines: string[] = [];
  if (change.caps_enabled !== undefined) {
    lines.push(change.caps_enabled
      ? "Caps on: each group gets a daily allowance from its tier's band."
      : "Caps off: every campaign that targets a group posts there every day.");
  }
  if (change.rotation_enabled !== undefined) {
    lines.push(change.rotation_enabled
      ? "Rotation on: a capped group's campaigns take turns, so each one sits out in turn."
      : "Rotation off: the same campaigns are held back every day, and they stop posting to that group.");
  }
  if (change.activity !== undefined) {
    lines.push(`Groups without a tier of their own move from ${settings.defaultActivity} to ${change.activity}.`);
  }
  for (const [tier, [low, high]] of Object.entries(change.bands ?? {})) {
    const [was, wasHigh] = settings.bands[tier];
    if (was !== low || wasHigh !== high) lines.push(`${tier}: ${was}–${wasHigh} becomes ${low}–${high} posts a day.`);
  }
  return lines;
}
