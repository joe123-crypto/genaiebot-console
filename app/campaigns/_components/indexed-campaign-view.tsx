"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHead } from "@/app/_components/ui";
import { SyncNotice, useLivePage } from "@/app/_components/live-page";
import { liveFetch, LoadMore, useLivePoll } from "@/app/_components/use-live";
import { CampaignGroups } from "./campaign-groups";
import { CampaignImages } from "./campaign-images";
import { CaptionVariants } from "./caption-variants";
import { CampaignSwitch } from "./campaign-switch";
import { loadCampaignGroupChoices } from "./group-choices";
import { canWrite } from "@/src/lib/write-capabilities";
import type { Campaign, AdAssets, PreviewRow } from "@/src/lib/types";
import type { CampaignRow, LivePage, SyncStatus, LiveContext } from "@/src/lib/live-types";

type Summary = { revision?: string; unchanged?: boolean; campaign: CampaignRow | null; context?: LiveContext; sync: SyncStatus };
export function IndexedCampaignView({ slug, initial, initialError, writable }: { slug: string; initial: Summary | null; initialError?: string; writable: boolean }) {
  const [summary, setSummary] = useState(initial);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const latest = useRef(summary); latest.current = summary;
  const [details, setDetails] = useState<{ campaign: Campaign; adAssets?: AdAssets } | null>(null);
  const [detailPending, setDetailPending] = useState(false);
  const [assignmentsOpen, setAssignmentsOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  async function read(signal?: AbortSignal) {
    const query = new URLSearchParams({ slug });
    if (latest.current?.revision) query.set("since", latest.current.revision);
    try { const next = await liveFetch<Summary>("campaign", query, signal);
      if (!signal?.aborted) { setSummary(previous => next.unchanged && previous ? { ...previous, sync: next.sync } : next); setError(null); } }
    catch (reason) { if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Updates unavailable."); }
  }
  useEffect(() => { if (initial) return; const controller = new AbortController(); void read(controller.signal); return () => controller.abort(); }, [initial]);
  useLivePoll(read);
  async function openDetails() {
    if (detailPending) return; setDetailPending(true);
    try { const data = await liveFetch<{ campaign: Campaign; adAssets?: AdAssets }>("detail", new URLSearchParams({ slug })); setDetails(data); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Details unavailable."); }
    finally { setDetailPending(false); }
  }
  const writes = summary?.context?.writes;
  return <div ref={root}><PageHead title={summary?.campaign?.name || slug} actions={<Link prefetch={false} href="/campaigns">All campaigns</Link>} />
    <SyncNotice sync={summary?.sync} error={error} />
    {summary?.campaign === null ? <p role="status">This campaign no longer exists. Any open draft is retained.</p> : null}
    {summary?.campaign ? <CampaignSwitch slug={slug} title={summary.campaign.name} storeEnabled={summary.campaign.storeEnabled ?? summary.campaign.enabled}
      cronEnabled={summary.campaign.cronEnabled} gate={canWrite(writable, writes, "campaigns", "enabled")} /> : null}
    <section className="card card-pad"><h2 className="card-title">Captions and pictures</h2>
      {!details ? <button className="btn" disabled={detailPending} onClick={openDetails}>{detailPending ? "Loading…" : "Open captions and pictures"}</button> : <>
        <CampaignImages images={details.campaign.images} assets={details.campaign.assets} adAssets={details.adAssets} assetDir="" writable={writable} writeUnavailableReason="Saved picture editing is not connected." />
        <CaptionVariants slug={slug} captions={details.campaign.captions} writable={writable} samples={[]}
          saveUnavailableReason={canWrite(writable, writes, "campaigns", "captions").allowed ? undefined : "Caption saving is unavailable."} />
      </>}
    </section>
    <section className="card card-pad"><h2 className="card-title">Where it goes</h2>
      {!assignmentsOpen ? <button className="btn" onClick={() => setAssignmentsOpen(true)}>Open group assignments</button> :
        <IndexedAssignments slug={slug} writable={writable} context={summary?.context} variantCount={summary?.campaign?.captionCount ?? 0} />}
    </section>
  </div>;
}
function IndexedAssignments({ slug, writable, context, variantCount }: { slug: string; writable: boolean; context?: LiveContext; variantCount: number }) {
  const root = useRef<HTMLDivElement>(null);
  const data = useLivePage<PreviewRow>("preview", null, new URLSearchParams({ slug }).toString(), row => row.jid, root);
  const liveGroups = useMemo(() => data.rows.map(({ caption, cap, ...row }) => row), [data.rows]);
  const knownGroups = useMemo(() => data.rows.map(row => ({ jid: row.jid, name: row.name, account: row.account, status: "active" as const })), [data.rows]);
  return <div ref={root}><SyncNotice sync={data.page?.sync} error={data.error} />
    <CampaignGroups slug={slug} liveGroups={liveGroups} knownGroups={knownGroups}
      loadChoices={loadCampaignGroupChoices} pagedChoices partialMembership variantCount={variantCount}
      membershipAvailable={Boolean(data.page?.rows)} membershipLoaded={Boolean(data.page?.rows)} previewAvailable={Boolean(data.page?.rows)}
      gate={canWrite(writable, context?.writes, "groups", "promos", "paused_promos", "weekly")} />
    <LoadMore next={data.page?.nextCursor} loading={data.loading} load={data.loadMore} /></div>;
}
