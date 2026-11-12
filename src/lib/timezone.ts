import { clockLabel } from "@/src/lib/format";

/**
 * The console shows one clock face, and the operator picks whose it is.
 *
 * Campaigns are planned in the bot's own timezone and the gateway keeps Algiers
 * hours, so an operator reading this screen is always converting in their head.
 * Everything here is display only: a time the bot owns is never rewritten by a
 * choice made in this module. Clock minutes travel in the bot's zone right up to
 * the moment they are printed, which is why the conversion is a label shift and
 * not a change of value.
 */
export const DISPLAY_TIMEZONES = [
  { zone: "Africa/Harare", label: "Harare (UTC+2)" },
  { zone: "Africa/Algiers", label: "Algiers (UTC+1)" },
] as const;

export type DisplayTimezone = (typeof DISPLAY_TIMEZONES)[number]["zone"];

export function isDisplayTimezone(value: unknown): value is DisplayTimezone {
  return typeof value === "string" && DISPLAY_TIMEZONES.some((entry) => entry.zone === value);
}

/** What to call a zone in a sentence, falling back to the IANA name for one the
 *  console does not offer -- a campaign may name any zone it likes. */
export function zoneLabel(zone: string) {
  return DISPLAY_TIMEZONES.find((entry) => entry.zone === zone)?.label ?? zone;
}

function zonedParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return { year: value("year"), month: value("month"), day: value("day"),
    hour: value("hour"), minute: value("minute") };
}

/** Minutes a zone is ahead of UTC at a given instant. Read from the formatted
 *  wall clock rather than a table, so a zone that does observe DST is right on
 *  both sides of the change. */
export function zoneOffsetMinutes(at: Date, timeZone: string) {
  const { year, month, day, hour, minute } = zonedParts(at, timeZone);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/**
 * What to add to a clock reading in `from` to read it in `to`. Harare to
 * Algiers is -60: a campaign at 09:00 Harare reads 08:00 in Algiers and goes
 * out at exactly the same moment either way.
 */
export function zoneShiftMinutes(from: string, to: string, at = new Date()) {
  if (from === to) return 0;
  try {
    return zoneOffsetMinutes(at, to) - zoneOffsetMinutes(at, from);
  } catch {
    // An unknown zone on either side -- a campaign carrying a typo, say. Showing
    // the time unshifted and labelled with its own zone beats showing nothing.
    return 0;
  }
}

/** Minutes since midnight in the bot's zone, printed on the chosen clock. */
export function displayClock(minutes: number, shift: number) {
  const whole = Math.round(minutes) + shift;
  return clockLabel(((whole % 1440) + 1440) % 1440);
}

/** The same, for a time that may land outside the day it started in -- a run
 *  that finishes after midnight, or one the shift pushes back before it. */
export function displayTimelineClock(minutes: number, shift: number) {
  const whole = Math.round(minutes) + shift;
  const days = Math.floor(whole / 1440);
  const clock = clockLabel(((whole % 1440) + 1440) % 1440);
  if (days === 0) return clock;
  const count = Math.abs(days);
  return `${clock} (${days > 0 ? "+" : "−"}${count} day${count === 1 ? "" : "s"})`;
}

/** A clock the operator typed, back on the bot's own scale. */
export function botMinutes(minutes: number, shift: number) {
  return (((Math.round(minutes) - shift) % 1440) + 1440) % 1440;
}

/**
 * An absolute moment, on the chosen clock and saying so. Replaces the three
 * frames these stamps used to print in -- raw UTC, the viewer's machine zone,
 * and the bot's -- which could not be compared against each other on sight.
 */
export function displayStamp(value: string | null | undefined, zone: string, fallback = "Unavailable") {
  if (!value) return fallback;
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) return fallback;
  try {
    const { year, month, day, hour, minute } = zonedParts(at, zone);
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)} ${zone}`;
  } catch {
    return fallback;
  }
}

/**
 * A campaign's posting time on the chosen clock. Each campaign names the zone
 * it runs in, which need not be either of the two the console offers, so the
 * shift is worked out from the campaign's own zone rather than the bot's.
 */
export function displaySlotLabel(
  campaign: { hour: number | null; minute: number | null; timezone: string },
  zone: string,
) {
  if (campaign.hour === null || campaign.minute === null) return "--:--";
  return displayClock(campaign.hour * 60 + campaign.minute, zoneShiftMinutes(campaign.timezone, zone));
}
