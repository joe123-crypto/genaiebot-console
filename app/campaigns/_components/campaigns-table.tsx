"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { Repeat2 } from "lucide-react";
import {
  Facet, FilterActions, FilterBar, FilterField, FilterSearch, FilterSummary, useUrlFilter,
} from "@/app/_components/filter-bar";
import { CampaignThumb } from "@/app/campaigns/_components/campaign-images";
import { CampaignRowActions } from "@/app/campaigns/_components/campaign-row-actions";
import {
  CAMPAIGN_FILTER_KEYS,
  CAMPAIGN_STATUS_LABEL,
  DEFAULT_CAMPAIGN_FILTER,
  campaignCadenceOptions,
  campaignFilterQuery,
  campaignLineOptions,
  campaignSlotOptions,
  filterCampaigns,
  isDefaultCampaignFilter,
  type CampaignFilter,
  type CampaignStatusChoice,
} from "@/src/domains/campaign-filter";
import { campaignLabel, campaignOffLabel, plural } from "@/src/lib/format";
import { displaySlotLabel } from "@/src/lib/timezone";
import { useDisplayTimezone } from "@/app/_components/timezone-context";
import { READ_ONLY_REASON, type WriteGate } from "@/src/lib/write-capabilities";
import type { CampaignRow } from "@/src/lib/live-types";
import type { Campaign } from "@/src/lib/types";

type TableCampaign = Omit<CampaignRow, "captionCount"> &
  Partial<Pick<Campaign, "captions" | "images" | "assets" | "script">> & { captionCount?: number };
type Props = {
  /** Every campaign, in the order the bridge sends them — which is the order
   *  they run through the day. Nothing here reorders them. */
  campaigns: TableCampaign[];
  /** Read from the URL on the server, and used only to seed the state below. */
  initialFilter: CampaignFilter;
  remote?: { onFilter: (filter: CampaignFilter) => void; total: number; lines: string[] };
  /** `WRITES_ENABLED` reads an unprefixed environment variable, so it is false
   *  in a browser bundle. The server page has to hand it over. */
  writesEnabled?: boolean;
  /** Whether the bot will take the campaign switch, and why not when it will
   *  not. Defaulting to denied means a caller that forgets these can only ever
   *  make the table more read-only, never less. */
  switchGate?: WriteGate;
  deleteGate?: WriteGate;
};

const STATUSES: CampaignStatusChoice[] = ["all", "running", "off", "failing", "no-groups"];

const NO_WRITES: WriteGate = { allowed: false, reason: READ_ONLY_REASON };

export function CampaignsTable({
  campaigns, initialFilter, writesEnabled = false,
  switchGate = NO_WRITES, deleteGate = NO_WRITES, remote,
}: Props) {
  const id = useId();
  // The hook decides which incoming filters are news: a link navigated to
  // while already here is applied, the sixty-second refresh is not.
  const displayZone = useDisplayTimezone();
  const [filter, setFilter] = useUrlFilter(
    initialFilter, campaignFilterQuery, CAMPAIGN_FILTER_KEYS,
  );
  const search = useRef<HTMLInputElement>(null);

  const changed = remote?.onFilter;
  useEffect(() => { changed?.(filter); }, [filter, changed]);
  const visible = remote ? campaigns : filterCampaigns(campaigns, filter);
  const unfiltered = isDefaultCampaignFilter(filter);
  const columns = writesEnabled ? 7 : 6;

  function set(key: keyof CampaignFilter, value: string) {
    setFilter((current) => ({ ...current, [key]: value }));
  }

  function clear() {
    setFilter(() => DEFAULT_CAMPAIGN_FILTER);
    // The button disables itself on this click, and a disabled element drops
    // focus to the body, which strands anyone navigating by keyboard.
    search.current?.focus();
  }

  return (
    <div className="card">
      <FilterBar label="Filter campaigns">
        <FilterSearch
          id={`${id}-q`}
          label="Search by name, id or ref"
          value={filter.q}
          placeholder="Search campaigns…"
          inputRef={search}
          onChange={(value) => set("q", value)}
        />

        <FilterField id={`${id}-status`} label="Status">
          <select
            id={`${id}-status`}
            value={filter.status}
            onChange={(event) => set("status", event.target.value)}
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {CAMPAIGN_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </FilterField>

        <Facet
          id={`${id}-line`}
          label="Line"
          value={filter.line}
          options={remote ? remote.lines.map(value => ({ value, label: value })) : campaignLineOptions(campaigns, filter.line)}
          onChange={(value) => set("line", value)}
        />
        <Facet
          id={`${id}-cadence`}
          label="Cadence"
          value={filter.cadence}
          options={campaignCadenceOptions()}
          onChange={(value) => set("cadence", value)}
        />
        <Facet
          id={`${id}-slot`}
          label="Slot"
          value={filter.slot}
          options={remote ? ["morning", "afternoon", "evening", "unscheduled"].map(value => ({ value, label: value })) : campaignSlotOptions(campaigns, filter.slot)}
          onChange={(value) => set("slot", value)}
        />

        <FilterActions>
          <button type="button" className="btn" onClick={clear} disabled={unfiltered}>
            Clear filters
          </button>
        </FilterActions>
      </FilterBar>

      <FilterSummary
        shown={visible.length}
        total={remote?.total ?? campaigns.length}
        noun="campaign"
        unfiltered={unfiltered && (!remote || visible.length === remote.total)}
      />

      <div
        className="table-wrap"
        role="region"
        aria-label="Campaigns, scroll horizontally for the full row"
        tabIndex={0}
      >
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Slot · {displayZone}</th>
              <th scope="col">Campaign</th>
              <th scope="col">Reach</th>
              <th scope="col">Line</th>
              <th scope="col">Ref</th>
              <th scope="col">Copy</th>
              {writesEnabled ? <th scope="col">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {visible.map((campaign) => (
              <tr data-live-id={campaign.slug} key={campaign.slug} className="campaign-preview-row">
                <td
                  className="cell-strong"
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    ...(campaign.enabled ? {} : { textDecoration: "line-through", opacity: 0.6 }),
                  }}
                  title={campaignOffLabel(campaign) ?? undefined}
                >
                  {displaySlotLabel(campaign, displayZone)}
                </td>
                <td>
                  <div className="cell-strong">
                    <Link prefetch={false}
                      className="campaign-preview-link"
                      href={`/campaigns/${campaign.slug}`}
                      aria-label={`Preview ${campaignLabel(campaign)}`}
                    >
                      {campaignLabel(campaign)}
                    </Link>
                  </div>
                  <div className="cell-mono">{campaign.source === "console" ? campaign.slug : campaign.name}</div>
                  {campaign.enabled ? null : (
                    <div className="pill pill-warning" style={{ marginTop: 4 }}>
                      {campaignOffLabel(campaign)}
                    </div>
                  )}
                  {campaign.error ? (
                    <div className="pill pill-danger" style={{ marginTop: 4 }}>
                      {campaign.error}
                    </div>
                  ) : null}
                </td>
                <td>
                  <span className="cell-strong">{campaign.targetCount}</span>{" "}
                  <span className="cell-muted">groups</span>
                  {campaign.weeklyCount > 0 ? (
                    <div className="pill" style={{ marginTop: 4 }}>
                      {campaign.weeklyCount} weekly only
                    </div>
                  ) : null}
                </td>
                <td>
                  <div className="tag-row">
                    {Object.entries(campaign.accounts).map(([account, count]) => (
                      <span key={account} className="tag">
                        {account} · {count}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  {campaign.tracking.prefix ? (
                    <span className="pill pill-info">{campaign.tracking.prefix}</span>
                  ) : (
                    <span className="cell-muted">none</span>
                  )}
                  {campaign.tracking.number ? (
                    <div className="cell-mono" style={{ marginTop: 4 }}>
                      {campaign.tracking.number}
                    </div>
                  ) : null}
                </td>
                <td className="cell-muted">
                  <div className="campaign-copy-cell">
                    {/* Decorative: the counts beside it say the same thing
                        as text, for anything that cannot see the picture. */}
                    <CampaignThumb images={campaign.images} assets={campaign.assets}
                      imageCount={campaign.imageCount} thumbnailUrl={campaign.thumbnailUrl} />
                    <span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <Repeat2 size={14} aria-hidden />
                        {plural((campaign.captionCount ?? campaign.captions?.length ?? 0), "variant")}
                      </span>
                      <br />
                      {campaign.imageCount !== undefined || campaign.images !== undefined
                        ? plural(campaign.imageCount ?? campaign.images?.length ?? 0, "image")
                        : "Images unavailable"}
                    </span>
                  </div>
                </td>
                {writesEnabled ? (
                  <td className="cell-actions">
                    <CampaignRowActions
                      slug={campaign.slug}
                      title={campaignLabel(campaign)}
                      storeEnabled={campaign.storeEnabled ?? campaign.enabled}
                      cronEnabled={campaign.cronEnabled}
                      gate={switchGate}
                      deleteGate={deleteGate}
                    />
                  </td>
                ) : null}
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns}>
                  <div className="empty">No campaign matches these filters.</div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
