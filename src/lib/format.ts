import { BOT_TIMEZONE } from "@/src/config";
import type { Campaign, Group } from "@/src/lib/types";

export function slotLabel(campaign: Pick<Campaign, "hour" | "minute">) {
  if (campaign.hour === null || campaign.minute === null) return "--:--";
  return `${String(campaign.hour).padStart(2, "0")}:${String(campaign.minute).padStart(2, "0")}`;
}

export function groupLabel(group: Pick<Group, "name" | "jid">) {
  return group.name ?? "Unnamed group";
}

/** The JID's leading id, which is what the operator recognises in logs. */
export function shortJid(jid: string) {
  return jid.replace(/@g\.us$/, "");
}

/** What an operator has to type to confirm a destructive action. `groupLabel`
 *  falls back to "Unnamed group", which dozens of rows share and so confirms
 *  nothing; the jid is at least unique to the row being acted on.
 *
 *  A blank name is treated as no name. Several rows carry one, and an empty
 *  label would be satisfied by typing nothing at all. */
export function confirmLabel(group: Pick<Group, "name" | "jid">) {
  return group.name?.trim() || shortJid(group.jid);
}

/** Slugs that are acronyms rather than words, so "cv" does not read "Cv". */
const ACRONYMS = new Set(["cv"]);

export function campaignTitle(slug: string) {
  return slug
    .split("-")
    .map((part) =>
      ACRONYMS.has(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}

/** What to call a campaign on screen.
 *
 *  One created from the console was named by the operator, so that name is the
 *  thing to show. One declared in the manifest has only a slug, and its title
 *  is made from it. Every label for the same campaign -- its link, its row's
 *  controls -- has to come from here, or a button ends up naming something
 *  other than the row it sits in. */
export function campaignLabel(campaign: { slug: string; name: string; source: "git" | "console" }) {
  return campaign.source === "console" ? campaign.name : campaignTitle(campaign.slug);
}

/** The one letter an avatar shows. A Google account always has a name, but
 *  `operatorFromToken` falls back to the address when the token carries none,
 *  and a name that is only spaces must still leave something to draw. */
export function avatarInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The engine spaces sends by a random 20-60s gap and waits up to 900s before
 * the first one, so a campaign's worst-case finish is what decides whether two
 * slots can collide. This mirrors `deploy/test_promo_send_spacing.py`.
 */
export function worstCaseRunSeconds(groupCount: number) {
  if (groupCount <= 0) return 0;
  return 900 + (groupCount - 1) * 60 + groupCount * 12;
}

/**
 * Minutes since midnight in the bot's own timezone, which is the scale every
 * slot on the timeline is already drawn on. The campaign day belongs to the
 * manifest's timezone rather than to the machine rendering it, so the zone is
 * asked for by name rather than assumed. Which clock those minutes are then
 * printed on is a separate question, answered in `src/lib/timezone`.
 */
export function minutesOfDay(now: Date, timeZone = BOT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const value = (type: "hour" | "minute") =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return value("hour") * 60 + value("minute");
}

/** Minutes since midnight as HH:MM, so a derived time prints like a slot's. */
export function clockLabel(minutes: number) {
  const whole = Math.round(minutes);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

export function timelineClockLabel(minutes: number) {
  const whole = Math.round(minutes);
  const days = Math.floor(whole / 1440);
  return `${clockLabel(whole % 1440)}${days > 0 ? ` (+${days} day${days === 1 ? "" : "s"})` : ""}`;
}

/** A bot calendar day (`YYYY-MM-DD`) as "Tue 17 Nov".
 *
 *  Formatted off the string's own parts rather than through a `Date`, which
 *  would be read in the viewer's zone and could name the day before. The
 *  rotation's days are the bot's, and an operator reading the console from
 *  another clock still has to see the day the advert goes out. */
export function botDayLabel(day: string): string | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!parts) return null;
  const [, year, month, date] = parts;
  const at = new Date(Date.UTC(Number(year), Number(month) - 1, Number(date)));
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", weekday: "short", day: "numeric", month: "short",
  }).format(at);
}

/**
 * Why a campaign assigned to a group is not posting there today, in a few
 * words -- or null when it is.
 *
 * Three different things make a chip look inactive and an operator has to be
 * able to tell them apart: a campaign switched off everywhere, one paused for
 * this group, and one that is simply not this group's turn today. Only the last
 * comes back on its own, which is the whole point of saying when.
 */
export function heldBackLabel(
  { nextDay, rotates }: { nextDay?: string; rotates: boolean },
): string {
  const held = "held back by today's cap";
  if (!rotates) return `${held} — turns are off, so this campaign always sits out`;
  const when = nextDay ? botDayLabel(nextDay) : null;
  return when ? `${held} — next posts ${when}` : `${held} — campaigns take turns`;
}

/**
 * Why a declared campaign is not posting, in a few words -- or null when it is.
 * Two switches decide it: the operator's own (in Firestore) and whether a cron
 * is registered. A bot older than the split reports only the combined one.
 */
export function campaignOffLabel(campaign: { enabled: boolean; storeEnabled?: boolean; cronEnabled?: boolean; scheduleStatus?: "ready" | "pending" }) {
  if (campaign.scheduleStatus === "pending") return "scheduling pending";
  if (campaign.enabled) return null;
  const switchedOff = campaign.storeEnabled === false;
  const noCron = campaign.cronEnabled === false;
  if (switchedOff && noCron) return "switched off · no cron";
  if (noCron) return "no cron registered";
  return "switched off";
}
