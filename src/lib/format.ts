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
