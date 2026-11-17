"use client";

import { useCallback, useEffect, useState } from "react";
import { liveFetch, useLivePoll } from "@/app/_components/use-live";

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

  return <section className="card card-pad" aria-labelledby="campaign-clicks-title">
    <h2 className="card-title" id="campaign-clicks-title">Estimated link clicks</h2>
    {unavailable ? <>
      <p className="card-note" role="status">
        {report ? "Click counts could not refresh. Showing the last available counts." : "Click counts are unavailable."}
      </p>
      <button type="button" className="btn" onClick={() => setAttempt(count => count + 1)}>Retry click counts</button>
    </> : null}
    {!report && !unavailable ? <p className="card-note" role="status">Loading click counts…</p> : null}
    {report ? <>
      <p><strong>{formatCount.format(report.totalClicks)}</strong> total clicks</p>
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
  </section>;
}
