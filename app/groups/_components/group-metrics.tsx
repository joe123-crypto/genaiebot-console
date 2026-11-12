import type { GroupMetrics } from "@/src/lib/types";
import { displayStamp } from "@/src/lib/timezone";

export const DMC_DESCRIPTION = "Incoming messages in the last 24 hours.";

function count(value: number | null | undefined) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value.toLocaleString("en-GB") : "—";
}

/** Takes the zone rather than reading it: this module renders inside a client
 *  table and a server component both, so it cannot hold the display context. */
export function observedAt(value: string | null | undefined, zone: string) {
  return displayStamp(value, zone);
}

export function DmcHeading() {
  return <th scope="col"><abbr title={`Daily Message Count. ${DMC_DESCRIPTION}`} aria-label="Daily Message Count">DMC</abbr></th>;
}

export function DmcValue({ metrics }: { metrics?: GroupMetrics }) {
  const available = metrics && metrics.coverage !== "unavailable";
  return (
    <span className="group-metric" title={DMC_DESCRIPTION}>
      <span className={available ? "cell-strong" : "cell-muted"}>
        {count(available ? metrics.dailyMessageCount : null)}
      </span>
      {metrics?.coverage === "partial" ? (
        <span className="pill" title="Some of the last 24 hours were not observed. This is the count collected so far.">Partial</span>
      ) : null}
    </span>
  );
}

export function MemberValue({ metrics, zone }: { metrics?: GroupMetrics; zone: string }) {
  const observed = Date.parse(metrics?.memberCountObservedAt ?? "");
  const asOf = Date.parse(metrics?.asOf ?? "");
  const stale = Number.isFinite(observed) && Number.isFinite(asOf) && asOf - observed > 2 * 3600_000;
  return (
    <span className="group-metric" title={`Members last observed: ${observedAt(metrics?.memberCountObservedAt, zone)}`}>
      <span className={metrics?.memberCount == null ? "cell-muted" : "cell-strong"}>{count(metrics?.memberCount)}</span>
      {stale && metrics?.memberCount != null ? <span className="pill">Stale</span> : null}
    </span>
  );
}

export function GroupDetails({ jid, note, metrics, zone }: { jid: string; note: string | null; metrics?: GroupMetrics; zone: string }) {
  return (
    <dl className="group-details">
      <div className="group-details-note"><dt>Note</dt><dd>{note?.trim() ? note : "No note."}</dd></div>
      <div><dt>Full group ID</dt><dd className="cell-mono">{jid}</dd></div>
      <div><dt>DMC observation period</dt><dd>{metrics
        ? `${observedAt(metrics.windowStart, zone)} to ${observedAt(metrics.asOf, zone)}` : "Unavailable"}</dd></div>
      <div><dt>DMC coverage</dt><dd>{metrics?.coverage === "complete"
        ? "Complete — the last 24 hours were observed."
        : metrics?.coverage === "partial"
          ? "Partial — initial collection or monitoring gaps; the count may be lower than actual activity."
          : "Unavailable — no activity observations are available."}</dd></div>
      <div><dt>Members last observed</dt><dd>{observedAt(metrics?.memberCountObservedAt, zone)}</dd></div>
    </dl>
  );
}
