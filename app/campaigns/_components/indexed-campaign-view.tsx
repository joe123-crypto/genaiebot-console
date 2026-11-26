"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHead, Section } from "@/app/_components/ui";
import { SyncNotice, useLivePage } from "@/app/_components/live-page";
import { liveFetch, LoadMore, useLivePoll } from "@/app/_components/use-live";
import { useDisplayTimezone } from "@/app/_components/timezone-context";
import { CampaignClicks } from "./campaign-clicks";
import { CampaignGroups } from "./campaign-groups";
import { CampaignImages } from "./campaign-images";
import { CaptionVariants } from "./caption-variants";
import { CampaignStatus, CampaignSwitch, NoCronNotice } from "./campaign-switch";
import { loadCampaignGroupChoices } from "./group-choices";
import { campaignOffLabel, plural } from "@/src/lib/format";
import { displaySlotLabel } from "@/src/lib/timezone";
import { canWrite } from "@/src/lib/write-capabilities";
import type { Campaign, AdAssets, PreviewRow } from "@/src/lib/types";
import type { CampaignRow, SyncStatus, LiveContext } from "@/src/lib/live-types";

type Summary = { revision?: string; unchanged?: boolean; campaign: CampaignRow | null; context?: LiveContext; sync: SyncStatus };
type Details = { campaign: Campaign; adAssets?: AdAssets };
type DetailResult = { data: Details } | { error: string };

/** What the page says under its own name: when it runs, and how much of it
 *  there is. Whether it is posting at all is the pill beside the name, so
 *  this line only has to stay honest about it ("would run"), not repeat it.
 *  Everything here is already loaded, so it costs no extra read. */
function campaignSummary(campaign: CampaignRow | null | undefined, zone: string) {
  if (!campaign) return undefined;
  const slot = displaySlotLabel(campaign, zone);
  const when = slot === "--:--" ? "No run time set"
    : `${campaignOffLabel(campaign) ? "Would run" : "Runs"} at ${slot} ${zone}`;
  return [when, plural(campaign.targetCount, "group"), plural(campaign.captionCount, "caption variant")].join(" · ");
}

export function IndexedCampaignView({ slug, initial, initialError, writable }: { slug: string; initial: Summary | null; initialError?: string; writable: boolean }) {
  const [summary, setSummary] = useState(initial);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const latest = useRef(summary); latest.current = summary;
  const [detailResult, setDetailResult] = useState<DetailResult | null>(null);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [assignmentsOpen, setAssignmentsOpen] = useState(false);
  const zone = useDisplayTimezone();
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
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function loadDetails() {
      try {
        const { campaign, adAssets } = await liveFetch<{ campaign: Campaign | null; adAssets?: AdAssets }>(
          "detail", new URLSearchParams({ slug }), signal,
        );
        if (signal.aborted) return;
        setDetailResult(campaign ? { data: { campaign, adAssets } } : { error: "Captions and pictures are unavailable." });
      } catch (reason) {
        if (!signal.aborted) {
          setDetailResult({ error: reason instanceof Error ? reason.message : "Captions and pictures are unavailable." });
        }
      }
    }
    void loadDetails();
    return () => controller.abort();
  }, [slug, detailAttempt]);

  function retryDetails() {
    setDetailResult(null);
    setDetailAttempt(attempt => attempt + 1);
  }

  const writes = summary?.context?.writes;
  const campaign = summary?.campaign;
  // The work -- what is sent, and where -- takes the wide column; what is
  // only looked at -- the counts, the pictures -- takes the rail beside it.
  return <div ref={root} className="campaign-detail page-stack">
    <PageHead back={{ href: "/campaigns", label: "All campaigns" }}
      title={campaign?.name || slug} subtitle={campaignSummary(campaign, zone)}
      status={campaign ? <CampaignStatus storeEnabled={campaign.storeEnabled ?? campaign.enabled}
        cronEnabled={campaign.cronEnabled} offLabel={campaignOffLabel(campaign)} /> : null}
      actions={campaign ? <CampaignSwitch slug={slug} title={campaign.name} storeEnabled={campaign.storeEnabled ?? campaign.enabled}
        cronEnabled={campaign.cronEnabled} gate={canWrite(writable, writes, "campaigns", "enabled")} /> : null} />
    <SyncNotice sync={summary?.sync} error={error} />
    {campaign === null ? <p role="status">This campaign no longer exists. Any open draft is retained.</p> : null}
    {campaign?.cronEnabled === false ? <NoCronNotice /> : null}

    <div className="page-columns">
      <div className="page-stack">
        {!detailResult ? <Section id="campaign-content" title="Caption variants">
          <p className="card-note" role="status">Loading captions and pictures…</p>
        </Section> : "error" in detailResult ? <Section id="campaign-content" title="Caption variants"
          actions={<button type="button" className="btn" onClick={retryDetails}>Retry</button>}>
          <p className="caption-error" role="alert">{detailResult.error}</p>
        </Section> : <CaptionVariants slug={slug} captions={detailResult.data.campaign.captions} writable={writable} samples={[]}
          saveUnavailableReason={canWrite(writable, writes, "campaigns", "captions").allowed ? undefined : "Caption saving is unavailable."} />}

        {/* Opened on request: the assignments are one more read per poll.
            CampaignGroups titles itself "Where it goes", so the closed card
            borrows that name and stays one row high. */}
        {assignmentsOpen
          ? <IndexedAssignments slug={slug} writable={writable} context={summary?.context} variantCount={campaign?.captionCount ?? 0} />
          : <Section id="campaign-assignments" title="Where it goes"
              description={campaign
                ? `Posts to ${plural(campaign.targetCount, "group")}. Open the list to see or change which variant each is sent.`
                : "The groups this campaign posts to, and the caption variant each one is sent."}
              actions={<button type="button" className="btn" onClick={() => setAssignmentsOpen(true)}>Show groups</button>} />}
      </div>

      <aside className="page-stack">
        {campaign ? <CampaignClicks key={slug} slug={slug} /> : null}
        {detailResult && "data" in detailResult ? <CampaignImages images={detailResult.data.campaign.images}
          assets={detailResult.data.campaign.assets} adAssets={detailResult.data.adAssets} assetDir=""
          writable={writable} writeUnavailableReason="Pictures can’t be changed from the console yet." /> : null}
      </aside>
    </div>
  </div>;
}
function IndexedAssignments({ slug, writable, context, variantCount }: { slug: string; writable: boolean; context?: LiveContext; variantCount: number }) {
  const root = useRef<HTMLDivElement>(null);
  const data = useLivePage<PreviewRow>("preview", null, new URLSearchParams({ slug }).toString(), row => row.jid, root);
  const liveGroups = useMemo(() => data.rows.map(({ caption, cap, ...row }) => row), [data.rows]);
  const knownGroups = useMemo(() => data.rows.map(row => ({ jid: row.jid, name: row.name, account: row.account, status: "active" as const })), [data.rows]);
  return <div ref={root} className="page-stack"><SyncNotice sync={data.page?.sync} error={data.error} />
    <CampaignGroups slug={slug} liveGroups={liveGroups} knownGroups={knownGroups}
      loadChoices={loadCampaignGroupChoices} pagedChoices partialMembership variantCount={variantCount}
      membershipAvailable={Boolean(data.page?.rows)} membershipLoaded={Boolean(data.page?.rows)} previewAvailable={Boolean(data.page?.rows)}
      gate={canWrite(writable, context?.writes, "groups", "promos", "paused_promos", "weekly")} />
    <LoadMore next={data.page?.nextCursor} loading={data.loading} load={data.loadMore} /></div>;
}
