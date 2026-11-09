"use client";

import Link from "next/link";
import { useId, useRef } from "react";
import { Repeat2 } from "lucide-react";
import {
  Facet, FilterActions, FilterBar, FilterField, FilterSearch, FilterSummary, useUrlFilter,
} from "@/app/_components/filter-bar";
import { CampaignThumb } from "@/app/campaigns/_components/campaign-images";
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
import { campaignOffLabel, campaignTitle, plural, slotLabel } from "@/src/lib/format";
import type { Campaign } from "@/src/lib/types";

type Props = {
  /** Every campaign, in the order the bridge sends them — which is the order
   *  they run through the day. Nothing here reorders them. */
  campaigns: Campaign[];
  /** Read from the URL on the server, and used only to seed the state below. */
  initialFilter: CampaignFilter;
};

const STATUSES: CampaignStatusChoice[] = ["all", "running", "off", "failing", "no-groups"];

const COLUMNS = 6;

export function CampaignsTable({ campaigns, initialFilter }: Props) {
  const id = useId();
  // The hook decides which incoming filters are news: a link navigated to
  // while already here is applied, the sixty-second refresh is not.
  const [filter, setFilter] = useUrlFilter(
    initialFilter, campaignFilterQuery, CAMPAIGN_FILTER_KEYS,
  );
  const search = useRef<HTMLInputElement>(null);

  const visible = filterCampaigns(campaigns, filter);
  const unfiltered = isDefaultCampaignFilter(filter);

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
          options={campaignLineOptions(campaigns, filter.line)}
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
          options={campaignSlotOptions(campaigns, filter.slot)}
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
        total={campaigns.length}
        noun="campaign"
        unfiltered={unfiltered}
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
              <th scope="col">Slot</th>
              <th scope="col">Campaign</th>
              <th scope="col">Reach</th>
              <th scope="col">Line</th>
              <th scope="col">Ref</th>
              <th scope="col">Copy</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((campaign) => (
              <tr key={campaign.slug} className="campaign-preview-row">
                <td
                  className="cell-strong"
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    ...(campaign.enabled ? {} : { textDecoration: "line-through", opacity: 0.6 }),
                  }}
                  title={campaignOffLabel(campaign) ?? undefined}
                >
                  {slotLabel(campaign)}
                </td>
                <td>
                  <div className="cell-strong">
                    <Link
                      className="campaign-preview-link"
                      href={`/campaigns/${campaign.slug}`}
                      aria-label={`Preview ${campaign.source === "console" ? campaign.name : campaignTitle(campaign.slug)}`}
                    >
                      {campaign.source === "console" ? campaign.name : campaignTitle(campaign.slug)}
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
                    <CampaignThumb images={campaign.images} assets={campaign.assets} />
                    <span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <Repeat2 size={14} aria-hidden />
                        {plural(campaign.captions.length, "variant")}
                      </span>
                      <br />
                      {plural(campaign.images.length, "image")}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS}>
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
