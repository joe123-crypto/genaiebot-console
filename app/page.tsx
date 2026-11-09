import Link from "next/link";
import { Shell } from "@/app/_components/shell-wrapper";
import { BotError, PageHead, Stat } from "@/app/_components/ui";
import { daySlots, loadOverview } from "@/src/domains/console";
import { campaignTitle, plural, worstCaseRunSeconds } from "@/src/lib/format";
import { BOT_TIMEZONE } from "@/src/config";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const result = await loadOverview();

  if (!result.ok) {
    return (
      <Shell>
        <PageHead title="Overview" />
        <BotError detail={result.detail} />
      </Shell>
    );
  }

  const { overview } = result;
  const slots = daySlots(overview);
  const active = overview.groupsByStatus.active ?? 0;
  const widest = Math.max(1, ...slots.map((slot) => slot.targetCount));

  return (
    <Shell overview={overview}>
      <PageHead
        title="Overview"
        subtitle={`Everything the bot plans to do on ${overview.date}, in ${BOT_TIMEZONE} time.`}
      />

      <div className="grid grid-stats" style={{ marginBottom: 16 }}>
        <Stat
          label="Active groups"
          value={active}
          note={`${overview.groupTotal} on record in total`}
        />
        <Stat
          label="Campaigns"
          value={overview.campaignTotal}
          note={slots.length > 0 ? `${slots[0].time} to ${slots[slots.length - 1].time}` : undefined}
        />
        <Stat
          label="Ads planned today"
          value={overview.plannedSendsToday}
          note={overview.capsEnabled ? "after daily caps" : "caps are off"}
        />
        <Stat
          label="WhatsApp lines"
          value={overview.accounts.length}
          note={overview.accounts.map((account) => account.id).join(" · ")}
        />
      </div>

      <div className="grid grid-two">
        <div className="card">
          <div className="card-head">
            <h2 className="card-title">Today&apos;s campaign slots</h2>
            <Link className="link" href="/schedule">
              Schedule
            </Link>
          </div>
          <div className="card-pad">
            <div className="timeline">
              {slots.map((slot) => {
                const onAds = (slot.accounts.ads ?? 0) > (slot.accounts.default ?? 0);
                return (
                  <div className="timeline-row" key={slot.slug}>
                    <span className="timeline-time">{slot.time}</span>
                    <span className="timeline-name">{campaignTitle(slot.slug)}</span>
                    <div className="timeline-bar">
                      <span
                        className={`timeline-fill${onAds ? " is-ads" : ""}`}
                        style={{ width: `${(slot.targetCount / widest) * 100}%` }}
                      />
                    </div>
                    <span className="timeline-count">{slot.targetCount}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2 className="card-title">WhatsApp lines</h2>
            <Link className="link" href="/lines">
              Lines
            </Link>
          </div>
          <div className="card-pad" style={{ display: "grid", gap: 12 }}>
            {overview.accounts.map((account) => {
              const reach = slots.reduce((total, slot) => total + (slot.accounts[account.id] ?? 0), 0);
              return (
                <div
                  key={account.id}
                  style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
                >
                  <span>
                    <span className="cell-strong">{account.id}</span>
                    {account.isContact ? <span className="pill pill-info" style={{ marginLeft: 8 }}>replies here</span> : null}
                    <br />
                    <span className="cell-mono">{account.number}</span>
                  </span>
                  <span className="cell-muted" style={{ textAlign: "right" }}>
                    {plural(reach, "send")} / day
                  </span>
                </div>
              );
            })}

            <p className="card-note" style={{ margin: 0, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
              The longest campaign today needs up to{" "}
              <strong>
                {Math.round(worstCaseRunSeconds(Math.max(0, ...slots.map((s) => s.targetCount))) / 60)} min
              </strong>{" "}
              to finish, because the engine spaces sends by a random 20-60s gap and waits up to
              15 min before the first one.
            </p>
          </div>
        </div>
      </div>
    </Shell>
  );
}
