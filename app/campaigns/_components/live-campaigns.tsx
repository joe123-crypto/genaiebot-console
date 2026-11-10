"use client";
import { useRef, useState } from "react";
import { CampaignsTable } from "./campaigns-table";
import { campaignFilterQuery, type CampaignFilter } from "@/src/domains/campaign-filter";
import { canDeleteCampaign, canWrite } from "@/src/lib/write-capabilities";
import type { CampaignRow, LivePage } from "@/src/lib/live-types";
import { SyncNotice, useLivePage } from "@/app/_components/live-page";
import { LoadMore, useDebounced } from "@/app/_components/use-live";

export function LiveCampaigns({ initial, initialError, filter: initialFilter, writable }: {
  initial: LivePage<CampaignRow> | null; initialError?: string; filter: CampaignFilter; writable: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState(initialFilter);
  const q = useDebounced(filter.q, 300);
  const data = useLivePage("campaigns", initial, campaignFilterQuery({ ...filter, q }).toString(), row => row.slug, root, initialError);
  // Existing table markup also serves legacy fixtures; compact rows contain counts only.
  const campaigns = data.rows.map(row => ({ ...row, captions: [], images: [], assets: [], script: "" }));
  const writes = data.page?.context?.writes;
  return <div ref={root}><SyncNotice sync={data.page?.sync} error={data.error} />
    {(data.page?.deletions ?? []).map(deletion => <div className="banner" role="status" key={deletion.slug}>{deletion.name} deleted. {deletion.cleanup === "complete" ? "Cleanup complete." : "Cleanup is pending; the bot retries automatically."} {deletion.detail}</div>)}
    <CampaignsTable campaigns={campaigns} initialFilter={initialFilter} writesEnabled={writable}
      switchGate={canWrite(writable, writes, "campaigns", "enabled")} deleteGate={canDeleteCampaign(writable, writes)}
      remote={{ onFilter: setFilter, total: data.page?.total ?? 0, lines: data.page?.facets?.lines ?? [] }} />
    <LoadMore next={data.page?.nextCursor} loading={data.loading} load={data.loadMore} /></div>;
}
