"use client";
import { authFetch } from "@/src/lib/auth-browser";

import { useEffect, useState } from "react";
import { LiveError, liveFetch, useLivePoll } from "@/app/_components/use-live";
import { plural } from "@/src/lib/format";
import { lineRows } from "@/src/domains/line-edit";
import type { LineSummary } from "@/src/domains/console";
import type { AccountsPayload } from "@/src/lib/account-types";

/** Each source answers for one card, so a failing one leaves the others standing. */
type Counts = { groups: number; lines: number } | null;
type Linked = { connected: number; total: number } | null;
type ClickTotals = { totalClicks: number; todayClicks: number; todayPartial: boolean };
const formatCount = new Intl.NumberFormat();

async function read<T>(path: string, signal?: AbortSignal) {
  const response = await authFetch(path, { cache: "no-store", signal });
  if (!response.ok) throw new Error("Unavailable.");
  return await response.json() as T;
}

/** The numbers beside the overlap card come from independent live sources. */
export function ScheduleCounts({ campaignsToday }: { campaignsToday: number }) {
  const [membership, setMembership] = useState<Counts>(null);
  const [campaigns, setCampaigns] = useState<number | null>(null);
  const [linked, setLinked] = useState<Linked>(null);
  const [clicks, setClicks] = useState<ClickTotals | null>(null);
  /** The status of the last failed read, 0 when it never reached the route. */
  const [clicksFailed, setClicksFailed] = useState<number | null>(null);

  async function load(signal?: AbortSignal) {
    const readClicks = liveFetch<ClickTotals>("campaign-clicks", new URLSearchParams(), signal)
      .then(totals => {
        if (signal?.aborted) return;
        setClicks(totals);
        setClicksFailed(null);
      })
      .catch((error: unknown) => {
        if (!signal?.aborted) setClicksFailed(error instanceof LiveError ? error.status : 0);
      });
    const [navigation, lines, accounts] = await Promise.allSettled([
      liveFetch<{ campaignTotal: number }>("navigation", new URLSearchParams(), signal),
      read<{ lines: LineSummary[] }>("/api/account-membership", signal),
      read<AccountsPayload>("/api/accounts", signal),
    ]);
    if (signal?.aborted) return;
    // Known counts survive a failed read; the card shows the last good number.
    if (navigation.status === "fulfilled") setCampaigns(navigation.value.campaignTotal);
    if (lines.status === "fulfilled") setMembership({
      groups: lines.value.lines.reduce((total, line) => total + line.groupCount, 0),
      lines: lines.value.lines.length,
    });
    if (accounts.status === "fulfilled") {
      // Counted the same way the Lines page lists them, so the two agree: the
      // `default` a gateway invents for a workspace that has made no lines is
      // not a line, and counting it would report one that is not there.
      const { ids } = lineRows(accounts.value.accounts, lines.status === "fulfilled" ? lines.value.lines : undefined);
      setLinked({
        connected: accounts.value.accounts.filter((account) => account.connected === true && ids.includes(account.id)).length,
        total: ids.length,
      });
    }
    await readClicks;
  }

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, []);
  useLivePoll(load);

  /** Totals are the one read a bot can refuse outright: a companion predating them
   *  rejects the slugless form rather than failing. That is a missing update, not an
   *  outage, and the card says so instead of reading as dead. */
  const needsBot = clicksFailed === 400 || clicksFailed === 404;

  return <div className="schedule-counts" role="status">
    <div className="card card-pad schedule-count">
      <div className="stat-label">Groups</div>
      <div className="stat-value">{membership ? membership.groups : "—"}</div>
      <div className="stat-note">{membership ? `Across ${plural(membership.lines, "line")}` : "Counting…"}</div>
    </div>
    <div className="card card-pad schedule-count">
      <div className="stat-label">Campaigns</div>
      <div className="stat-value">{campaigns ?? "—"}</div>
      <div className="stat-note">{`${campaignsToday} on today's timeline`}</div>
    </div>
    <div className="card card-pad schedule-count">
      <div className="stat-label">Lines connected</div>
      <div className="stat-value">{linked ? `${linked.connected} of ${linked.total}` : "—"}</div>
      <div className="stat-note">{!linked ? "Status unavailable" : linked.total === 0 ? "No lines yet" : "WhatsApp linked"}</div>
    </div>
    <div className="card card-pad schedule-count">
      <div className="stat-label">Total link clicks</div>
      <div className="stat-value">{clicks ? formatCount.format(clicks.totalClicks) : "—"}</div>
      <div className="stat-note">
        {clicksFailed === null ? "All time"
          : clicks ? "All time · last available"
          : needsBot ? "All time · needs the bot update"
          : "All time · unavailable"}
      </div>
      <div className="stat-note">
        {clicks && clicksFailed !== null
          ? `Last daily count · ${formatCount.format(clicks.todayClicks)}`
          : !clicks && needsBot
            ? "Deploy the companion bot update for click totals."
            : `${clicks ? formatCount.format(clicks.todayClicks) : "—"} today${clicks?.todayPartial ? " (since update)" : ""}`}
      </div>
    </div>
  </div>;
}
