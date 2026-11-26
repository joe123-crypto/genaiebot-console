"use client";

import { useCallback, useEffect, useState } from "react";
import { liveFetch, useLivePoll } from "@/app/_components/use-live";
import { Section, Stat } from "@/app/_components/ui";

type ClickReport = {
  totalClicks: number;
  groups: { jid: string; name: string; clicks: number }[];
};

const formatCount = new Intl.NumberFormat();

export function CampaignClicks({ slug }: { slug: string }) {
  const [report, setReport] = useState<ClickReport | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const read = useCallback(async (signal: AbortSignal) => {
    try {
      const next = await liveFetch<ClickReport>("campaign-clicks", new URLSearchParams({ slug }), signal);
      if (signal.aborted) return;
      setReport(next);
      setUnavailable(false);
    } catch {
      if (!signal.aborted) setUnavailable(true);
    }
  }, [slug]);

  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal);
    return () => controller.abort();
  }, [read, attempt]);
  useLivePoll(read);

  return <Section id="campaign-clicks" title="Estimated link clicks"
    actions={unavailable ? <button type="button" className="btn btn-sm" onClick={() => setAttempt(count => count + 1)}>Retry click counts</button> : null}>
    {unavailable || !report ? <p className="card-note campaign-clicks-status" role="status">
      {unavailable
        ? report ? "Click counts could not refresh. Showing the last available counts." : "Click counts are unavailable."
        : "Loading click counts…"}
    </p> : null}
    {report ? <>
      <Stat plain label="Total clicks" value={formatCount.format(report.totalClicks)} />
      {report.groups.length ? <details className="campaign-clicks-groups">
        <summary>Clicks by group <span className="card-note">
          {report.groups.length} {report.groups.length === 1 ? "group" : "groups"}
        </span></summary>
        <div className="table-wrap">
          <table className="data" aria-label="Link clicks by group">
            <thead><tr><th scope="col">Group</th><th scope="col">Clicks</th></tr></thead>
            <tbody>{report.groups.map(group => <tr key={group.jid}>
              <td>{group.name}</td><td>{formatCount.format(group.clicks)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </details> : null}
    </> : null}
  </Section>;
}
