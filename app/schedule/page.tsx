import { Shell } from "@/app/_components/shell-wrapper";
import { BotError, PageHead } from "@/app/_components/ui";
import { daySlots, loadOverview, nextUp, runEndsAt, runningNow } from "@/src/domains/console";
import { campaignTitle, clockLabel, minutesOfDay, plural, worstCaseRunSeconds } from "@/src/lib/format";
import { BOT_TIMEZONE } from "@/src/config";

export const dynamic = "force-dynamic";

const DAY_MINUTES = 24 * 60;

export default async function SchedulePage() {
  const result = await loadOverview();

  if (!result.ok) {
    return (
      <Shell>
        <PageHead title="Schedule" />
        <BotError detail={result.detail} />
      </Shell>
    );
  }

  const slots = daySlots(result.overview);

  /**
   * Two campaigns on the same line must not overlap: a run can start up to
   * 15 min late and then needs a random 20-60s per group. This is the rule
   * `deploy/test_promo_send_spacing.py` asserts, shown rather than assumed.
   */
  const perAccount = new Map<string, typeof slots>();
  for (const slot of slots) {
    const owner =
      Object.entries(slot.accounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "default";
    perAccount.set(owner, [...(perAccount.get(owner) ?? []), slot]);
  }

  const clashes: string[] = [];
  for (const [account, accountSlots] of perAccount) {
    for (let index = 0; index < accountSlots.length - 1; index += 1) {
      const current = accountSlots[index];
      const next = accountSlots[index + 1];
      const finishes = runEndsAt(current);
      if (finishes > next.minutes) {
        clashes.push(
          `On the ${account} line, ${campaignTitle(current.slug)} can still be sending at ` +
            `${clockLabel(finishes)}, after ${campaignTitle(next.slug)} starts at ${next.time}.`,
        );
      }
    }
  }

  /**
   * The clock is the one thing on this screen that is not genaebot's own state,
   * so it is read here, per render. The console already refreshes every 60s,
   * which is what moves the marker; the sidebar says when that has paused.
   */
  const nowMinutes = minutesOfDay(new Date());
  const running = runningNow(slots, nowMinutes);
  const runningSlugs = new Set(running.map((slot) => slot.slug));
  const upcoming = nextUp(slots, nowMinutes);
  const nowOffset = `${(nowMinutes / DAY_MINUTES) * 100}%`;

  const runningNames = running.map((slot) => campaignTitle(slot.slug));
  const sendingNow =
    runningNames.length > 1
      ? `${runningNames.slice(0, -1).join(", ")} and ${runningNames[runningNames.length - 1]}`
      : runningNames[0];

  return (
    <Shell>
      <PageHead
        title="Schedule"
        subtitle={`The campaign day in ${BOT_TIMEZONE}. Bars show each run's worst case, not its typical length.`}
      />

      {clashes.length > 0 ? (
        <div className="banner" style={{ display: "block" }}>
          <strong>Two campaigns on one line could overlap.</strong>
          {clashes.map((clash) => (
            <div key={clash} style={{ marginTop: 6 }}>
              {clash}
            </div>
          ))}
        </div>
      ) : null}

      <div className="card">
        <div className="card-head">
          <h2 className="card-title">Day timeline</h2>
          <span className="card-note">
            Purple runs on the ads line, blue on the default line.
          </span>
        </div>
        <div className="card-pad">
          {/* Worst case, so a lit bar means "could still be sending", never
              "is sending" — the wording has to stay weaker than the bar. */}
          <div className="timeline-status" role="status">
            <span className={`run-dot${running.length > 0 ? " is-live" : ""}`} aria-hidden />
            <span className="cell-mono">
              {clockLabel(nowMinutes)} in {BOT_TIMEZONE}
            </span>
            <span>
              {running.length > 0
                ? `${sendingNow} could still be sending.`
                : upcoming
                  ? `Nothing sending. ${campaignTitle(upcoming.slug)} is next at ${upcoming.time}.`
                  : "Nothing sending. The day's runs are over."}
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "150px 1fr",
              gap: 12,
              marginBottom: 2,
            }}
          >
            <span />
            <div style={{ position: "relative", height: 14 }} className="cell-mono">
              <span className="timeline-now-label" style={{ left: nowOffset }}>
                now
              </span>
            </div>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            {slots.map((slot) => {
              const runMinutes = worstCaseRunSeconds(slot.targetCount) / 60;
              const onAds = (slot.accounts.ads ?? 0) > (slot.accounts.default ?? 0);
              const isRunning = runningSlugs.has(slot.slug);
              const isDone = runEndsAt(slot) <= nowMinutes;
              const endsAt = clockLabel(runEndsAt(slot));
              return (
                <div key={slot.slug} style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 12, alignItems: "center" }}>
                  <span>
                    <span className="cell-strong">{campaignTitle(slot.slug)}</span>
                    <br />
                    <span className="cell-mono">
                      {slot.time} · {plural(slot.targetCount, "group")}
                    </span>
                    {isRunning ? (
                      <>
                        <br />
                        <span
                          className="pill pill-success"
                          style={{ marginTop: 3 }}
                          title={`started at ${slot.time}, worst case runs to ${endsAt} — it may already have finished`}
                        >
                          <span className="run-dot is-live" aria-hidden /> Running now
                        </span>
                      </>
                    ) : null}
                  </span>
                  <div
                    style={{
                      position: "relative",
                      height: 26,
                      borderRadius: 7,
                      background: "var(--surface-muted)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <span
                      className={`timeline-fill${onAds ? " is-ads" : ""}${isRunning ? " is-running" : ""}${isDone ? " is-done" : ""}`}
                      title={`${slot.time} to ${endsAt} at worst`}
                      style={{
                        left: `${(slot.minutes / DAY_MINUTES) * 100}%`,
                        right: "auto",
                        width: `${Math.max(6, (runMinutes / DAY_MINUTES) * 100)}%`,
                        minWidth: 0,
                        justifyContent: "center",
                        fontSize: 10.5,
                      }}
                    >
                      {Math.round(runMinutes)}m
                    </span>
                    <span className="timeline-now" style={{ left: nowOffset }} aria-hidden />
                  </div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "150px 1fr",
              gap: 12,
              marginTop: 10,
              paddingTop: 10,
              borderTop: "1px solid var(--border)",
            }}
          >
            <span />
            <div style={{ display: "flex", justifyContent: "space-between" }} className="cell-mono">
              {["00:00", "06:00", "12:00", "18:00", "24:00"].map((mark) => (
                <span key={mark}>{mark}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
