"use client";
import { liveFetch } from "@/app/_components/use-live";
import type { LivePage, Group } from "@/src/lib/live-types";
import type { KnownCampaignGroup } from "@/src/lib/campaign-group-draft";

/** Load the directory only when the picker opens, or look up just saved draft additions. */
export async function loadCampaignGroupChoices(jids?: string[]): Promise<KnownCampaignGroup[]> {
  if (jids !== undefined && (!Array.isArray(jids) || jids.length > 100 ||
    jids.some((jid) => typeof jid !== "string" || !/^\d+(?:-\d+)?@g\.us$/.test(jid)))) throw new Error("Invalid group selection.");
  const groups: Group[] = [];
  if (jids) {
    for (let i = 0; i < jids.length; i += 10) {
      const page = await liveFetch<LivePage<Group>>("groups", new URLSearchParams({ ids: jids.slice(i, i + 10).join(",") }));
      groups.push(...page.rows ?? []);
    }
  } else {
    const page = await liveFetch<LivePage<Group>>("groups", new URLSearchParams({ status: "active" }));
    groups.push(...page.rows ?? []);
  }
  return groups.map(({ jid, name, account, status }) => ({ jid, name, account, status }));
}

