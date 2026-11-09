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
 * slot on the timeline is already drawn on. Harare is UTC+2 all year, but the
 * campaign day belongs to the manifest's timezone rather than to the machine
 * rendering it, so the zone is asked for by name rather than assumed.
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
