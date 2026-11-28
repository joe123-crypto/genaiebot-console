"use client";
import { useRef, useState } from "react";
import { CampaignsTable } from "./campaigns-table";
import { campaignFilterQuery, type CampaignFilter } from "@/src/domains/campaign-filter";
import { canDeleteCampaign, canWrite } from "@/src/lib/write-capabilities";
import type { CampaignRow, LivePage } from "@/src/lib/live-types";
import { SyncNotice, useLivePage } from "@/app/_components/live-page";
import { LoadMore, useDebounced } from "@/app/_components/use-live";
import { useMobileLayout } from "@/app/_components/use-mobile-layout";

export function LiveCampaigns({ initial, initialError, filter: initialFilter, writable }: {
  initial: LivePage<CampaignRow> | null; initialError?: string; filter: CampaignFilter; writable: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const scrollRoot = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState(initialFilter);
  const q = useDebounced(filter.q, 300);
  /* On a phone the table is laid out at full height and the page scrolls, so
     the anchor and the sentinel both have to follow the window: an observer
     rooted on a box that no longer scrolls never stops intersecting, and would
     walk through every page of results on its own. */
  const scroller = useMobileLayout() ? undefined : scrollRoot;
  const data = useLivePage("campaigns", initial, campaignFilterQuery({ ...filter, q }).toString(), row => row.slug, root, initialError, scroller);
  const writes = data.page?.context?.writes;
  const deleteGate = canDeleteCampaign(writable, writes);
  return <div ref={root} className="campaigns-viewport"><div className="campaigns-notices"><SyncNotice sync={data.page?.sync} error={data.error} />
    {/* Only once a payload has arrived: with no `writes` yet the gate reports an older bot,
        which would be a wrong reason to show beside a plain connection failure. */}
    {writable && data.page && !deleteGate.allowed ? <div className="banner" role="status">Deleting campaigns is unavailable. {deleteGate.reason}</div> : null}
    {/* The bot keeps a deletion's record for good, so a finished one would be
        a banner forever. Only cleanup still being retried needs saying. */}
    {(data.page?.deletions ?? []).filter(deletion => deletion.cleanup === "pending").map(deletion =>
      <div className="banner" role="status" key={deletion.slug}>{deletion.name} deleted. Cleanup is pending; the bot retries automatically. {deletion.detail}</div>)}
    </div>
    <CampaignsTable scrollRef={scrollRoot} endRef={end} campaigns={data.rows} initialFilter={initialFilter} writesEnabled={writable}
      switchGate={canWrite(writable, writes, "campaigns", "enabled")} deleteGate={deleteGate}
      remote={{ onFilter: setFilter, total: data.page?.total ?? 0, lines: data.page?.facets?.lines ?? [] }} />
    <LoadMore scrollRoot={scroller} target={end} next={data.page?.nextCursor} loading={data.loading} load={data.loadMore} /></div>;
}
