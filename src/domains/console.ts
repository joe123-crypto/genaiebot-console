import { cache } from "react";
import { BotUnavailableError, getOverview } from "@/src/lib/bot-client";
import { slotLabel } from "@/src/lib/format";
import type { Group, Overview } from "@/src/lib/types";

/** Deduped so the layout and the page it wraps share one read per request. */
export const loadOverview = cache(async (): Promise<
  { ok: true; overview: Overview } | { ok: false; detail: string }
> => {
  try {
    return { ok: true, overview: await getOverview() };
  } catch (error) {
    if (error instanceof BotUnavailableError) return { ok: false, detail: error.detail };
    throw error;
  }
});

export type Attention = { label: string; detail?: string };

/**
 * What the bot needs a person for right now. Empty is the normal state, and the
 * card disappears entirely when it is — this is not an onboarding checklist.
 */
export function attentionItems(overview: Overview): Attention[] {
  const items: Attention[] = [];

  const adminOnly = overview.groupsByStatus["admin-only"] ?? 0;
  const notMember = overview.groupsByStatus["not-a-member"] ?? 0;
  const onHold = overview.groupsByStatus["on-hold"] ?? 0;

  const broken = overview.campaigns.filter((campaign) => campaign.error);
  if (broken.length > 0) {
    items.push({ label: "Campaigns failing to load", detail: String(broken.length) });
  }

  const empty = overview.campaigns.filter(
    (campaign) => campaign.enabled && !campaign.error && campaign.targetCount === 0,
  );
  if (empty.length > 0) {
    items.push({ label: "Campaigns with no groups", detail: String(empty.length) });
  }

  if (onHold > 0) items.push({ label: "Groups on hold", detail: String(onHold) });
  if (adminOnly > 0) items.push({ label: "Groups the bot cannot post in", detail: String(adminOnly) });
  if (notMember > 0) items.push({ label: "Groups the bot has left", detail: String(notMember) });

  if (!overview.capsEnabled) {
    items.push({ label: "Daily ad caps are off" });
  }

  return items;
}

/**
 * Campaign slots ordered through the day, used by Overview and Schedule.
 *
 * A switched-off campaign is left out rather than drawn faintly: the timeline
 * feeds the per-line overlap rule, and a campaign that installs no cron can
 * neither occupy a slot nor collide with one. The Campaigns screen is where it
 * is still listed, marked off.
 */
export type LinePromo = { slug: string; count: number; off: boolean };

export type LineSummary = {
  id: string;
  number: string;
  isContact: boolean;
  groupCount: number;
  advertisingCount: number;
  /** Campaigns this line actually posts. A switched-off one is configured on
   *  its groups but installs no cron, so counting it would overstate what the
   *  line does. */
  campaignCount: number;
  /** Every configured campaign, switched-off ones included and flagged, so the
   *  screen can show the configuration AND what it really does. */
  promos: LinePromo[];
};

/**
 * What each WhatsApp line carries. A group's `promos` is configured intent and
 * keeps a switched-off campaign on purpose, so the two have to be told apart
 * here rather than at the call site — the Groups screen already makes the same
 * distinction with the same `disabledPromos` list.
 */
export function lineSummaries(
  overview: Overview,
  groups: Group[],
  disabledPromos: string[],
): LineSummary[] {
  const off = new Set(disabledPromos);

  return overview.accounts.map((account) => {
    const mine = groups.filter((group) => group.account === account.id);
    const active = mine.filter((group) => group.status === "active");

    const counts = new Map<string, number>();
    for (const group of active) {
      for (const promo of group.promos) {
        counts.set(promo, (counts.get(promo) ?? 0) + 1);
      }
    }

    const promos = [...counts.entries()]
      .map(([slug, count]) => ({ slug, count, off: off.has(slug) }))
      .sort((a, b) => b.count - a.count);

    return {
      id: account.id,
      number: account.number,
      isContact: account.isContact,
      groupCount: mine.length,
      advertisingCount: active.length,
      campaignCount: promos.filter((promo) => !promo.off).length,
      promos,
    };
  });
}

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
