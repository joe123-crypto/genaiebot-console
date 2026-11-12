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
  const writes = data.page?.context?.writes;
  const deleteGate = canDeleteCampaign(writable, writes);
  return <div ref={root}><SyncNotice sync={data.page?.sync} error={data.error} />
    {/* Only once a payload has arrived: with no `writes` yet the gate reports an older bot,
        which would be a wrong reason to show beside a plain connection failure. */}
    {writable && data.page && !deleteGate.allowed ? <div className="banner" role="status">Deleting campaigns is unavailable. {deleteGate.reason}</div> : null}
    {(data.page?.deletions ?? []).map(deletion => <div className="banner" role="status" key={deletion.slug}>{deletion.name} deleted. {deletion.cleanup === "complete" ? "Cleanup complete." : "Cleanup is pending; the bot retries automatically."} {deletion.detail}</div>)}
    <CampaignsTable campaigns={data.rows} initialFilter={initialFilter} writesEnabled={writable}
      switchGate={canWrite(writable, writes, "campaigns", "enabled")} deleteGate={deleteGate}
      remote={{ onFilter: setFilter, total: data.page?.total ?? 0, lines: data.page?.facets?.lines ?? [] }} />
    <LoadMore next={data.page?.nextCursor} loading={data.loading} load={data.loadMore} /></div>;
}
