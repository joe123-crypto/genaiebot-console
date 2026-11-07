import { clockLabel, slotLabel, worstCaseRunSeconds } from "@/src/lib/format";
import type { Overview } from "@/src/lib/types";

/**
 * The campaign day: the slots, where each run ends, what is running, and the
 * per-line overlap rule.
 *
 * Pure on purpose, and deliberately free of `@/src/lib/bot-client`. The
 * Schedule screen's timeline is a client component — a bar on it is dragged to
 * a new time — so everything it recomputes while dragging has to be reachable
 * from the browser bundle, which the bot adapters (`node:child_process`) are
 * not. `src/domains/console` re-exports all of it.
 */

/**
 * Campaign slots ordered through the day, used by Overview and Schedule.
 *
 * A switched-off campaign is left out rather than drawn faintly: the timeline
 * feeds the per-line overlap rule, and a campaign that installs no cron can
 * neither occupy a slot nor collide with one. The Campaigns screen is where it
 * is still listed, marked off.
 */
export function daySlots(overview: Overview) {
  return overview.campaigns
    .filter((campaign) => campaign.enabled && campaign.hour !== null)
    .map((campaign) => ({
      slug: campaign.slug,
      name: campaign.name,
      time: slotLabel(campaign),
      minutes: (campaign.hour ?? 0) * 60 + (campaign.minute ?? 0),
      targetCount: campaign.targetCount,
      accounts: campaign.accounts,
    }))
    .sort((a, b) => a.minutes - b.minutes);
}

export type DaySlot = ReturnType<typeof daySlots>[number];

/**
 * When a slot's worst case is over, in minutes since midnight. The overlap rule
 * and the running marker have to agree on where a run ends, so both ask here.
 */
export function runEndsAt(slot: DaySlot) {
  return slot.minutes + worstCaseRunSeconds(slot.targetCount) / 60;
}

/**
 * Slots whose worst case still covers `nowMinutes`. The window is half-open, so
 * a run is marked from its own start minute and released the minute its worst
 * case expires. More than one slot can come back — that is exactly the overlap
 * the Schedule banner warns about, and hiding it here would contradict it.
 */
export function runningNow(slots: DaySlot[], nowMinutes: number) {
  return slots.filter((slot) => slot.minutes <= nowMinutes && nowMinutes < runEndsAt(slot));
}

/** The first slot still to start, or undefined once the day's last one has. */
export function nextUp(slots: DaySlot[], nowMinutes: number) {
  return slots.find((slot) => slot.minutes > nowMinutes);
}

/**
 * Which line a slot belongs to: the one carrying most of its groups. The
 * overlap rule is per-line, so a slot has to be attributed to exactly one even
 * though `accounts` is a tally across several.
 *
 * This is not quite the question the bar's colour asks — that one is only
 * "ads or not" — and the two can part company for a campaign whose largest
 * line is a third one. Changing the colour is a separate decision.
 */
export function lineOf(slot: DaySlot) {
  return Object.entries(slot.accounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "default";
}

export type Clash = {
  account: string;
  /** The run that is still going. */
  current: DaySlot;
  /** The run it would be going into. */
  next: DaySlot;
  /** Minutes since midnight at which `current`'s worst case ends. */
  finishes: number;
};

/**
 * Two campaigns on the same line must not overlap: a run can start up to
 * 15 min late and then needs a random 20-60s per group. This is the rule
 * `deploy/test_promo_send_spacing.py` asserts, reported rather than assumed.
 *
 * Only adjacent pairs are compared, so one long run swallowing two later slots
 * is reported once — as the collision an operator has to fix first.
 *
 * The slots are sorted here rather than taken on trust: `daySlots` returns them
 * in order, but a time being dragged on the Schedule screen can cross its
 * neighbour, and comparing that unsorted would quietly miss the clash.
 */
export function clashes(slots: DaySlot[]): Clash[] {
  const perAccount = new Map<string, DaySlot[]>();
  for (const slot of [...slots].sort((a, b) => a.minutes - b.minutes)) {
    const account = lineOf(slot);
    perAccount.set(account, [...(perAccount.get(account) ?? []), slot]);
  }

  const found: Clash[] = [];
  for (const [account, accountSlots] of perAccount) {
    for (let index = 0; index < accountSlots.length - 1; index += 1) {
      const current = accountSlots[index];
      const next = accountSlots[index + 1];
      const finishes = runEndsAt(current);
      if (finishes > next.minutes) found.push({ account, current, next, finishes });
    }
  }
  return found;
}

/**
 * The same slots at drafted start times, ordered and relabelled as the server
 * would have produced them. Every live recalculation on the Schedule screen —
 * the overlap banner, the running marker, what is next — runs through this, so
 * a dragged bar cannot be read on a different shape from a saved one.
 */
export function withTimes(slots: DaySlot[], times: Record<string, number>): DaySlot[] {
  return slots
    .map((slot) => {
      const minutes = times[slot.slug];
      if (minutes === undefined || minutes === slot.minutes) return slot;
      return { ...slot, minutes, time: clockLabel(minutes) };
    })
    .sort((a, b) => a.minutes - b.minutes);
}
