"use client";

import { useEffect, useState } from "react";
import { liveFetch, useLivePoll } from "@/app/_components/use-live";
import { plural } from "@/src/lib/format";
import type { LineSummary } from "@/src/domains/console";
import type { AccountsPayload } from "@/src/lib/account-types";

/** Each source answers for one card, so a failing one leaves the others standing. */
type Counts = { groups: number; lines: number } | null;
type Linked = { connected: number; total: number } | null;

async function read<T>(path: string, signal?: AbortSignal) {
  const response = await fetch(path, { cache: "no-store", signal });
  if (!response.ok) throw new Error("Unavailable.");
  return await response.json() as T;
}

/** The three numbers beside the overlap card. They come from the screens that own
 * them — the live navigation count, the line membership summary and the account
 * gateway — because the schedule view carries only today's slots. */
export function ScheduleCounts({ campaignsToday }: { campaignsToday: number }) {
  const [membership, setMembership] = useState<Counts>(null);
  const [campaigns, setCampaigns] = useState<number | null>(null);
  const [linked, setLinked] = useState<Linked>(null);

  async function load(signal?: AbortSignal) {
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
    if (accounts.status === "fulfilled") setLinked({
      connected: accounts.value.accounts.filter((account) => account.connected === true).length,
      total: accounts.value.accounts.length,
    });
  }

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, []);
  useLivePoll(load);

  /** A line whose status never arrived is not a disconnected line. */
  const unknown = linked !== null && linked.total === 0;

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
      <div className="stat-value">{linked && !unknown ? `${linked.connected} of ${linked.total}` : "—"}</div>
      <div className="stat-note">{linked && !unknown ? "WhatsApp linked" : "Status unavailable"}</div>
    </div>
  </div>;
}
