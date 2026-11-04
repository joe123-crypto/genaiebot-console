import { Shell } from "@/app/_components/shell-wrapper";
import { BotError, PageHead } from "@/app/_components/ui";
import { daySlots, loadOverview } from "@/src/domains/console";
import { campaignTitle, plural, worstCaseRunSeconds } from "@/src/lib/format";
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
      const finishes = current.minutes + worstCaseRunSeconds(current.targetCount) / 60;
      if (finishes > next.minutes) {
        clashes.push(
          `On the ${account} line, ${campaignTitle(current.slug)} can still be sending at ` +
            `${String(Math.floor(finishes / 60)).padStart(2, "0")}:${String(Math.round(finishes % 60)).padStart(2, "0")}, ` +
            `after ${campaignTitle(next.slug)} starts at ${next.time}.`,
        );
      }
    }
  }

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
          <div style={{ display: "grid", gap: 6 }}>
            {slots.map((slot) => {
              const runMinutes = worstCaseRunSeconds(slot.targetCount) / 60;
              const onAds = (slot.accounts.ads ?? 0) > (slot.accounts.default ?? 0);
              return (
                <div key={slot.slug} style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 12, alignItems: "center" }}>
                  <span>
                    <span className="cell-strong">{campaignTitle(slot.slug)}</span>
                    <br />
                    <span className="cell-mono">
                      {slot.time} · {plural(slot.targetCount, "group")}
                    </span>
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
                      className={`timeline-fill${onAds ? " is-ads" : ""}`}
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
