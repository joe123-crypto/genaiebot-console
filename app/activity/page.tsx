import { Shell } from "@/app/_components/shell-wrapper";
import { PageHead } from "@/app/_components/ui";

export const dynamic = "force-dynamic";

export default function ActivityPage() {
  return (
    <Shell>
      <PageHead
        title="Activity"
        subtitle="What the bot actually sent, skipped and failed, and which ads people replied to."
      />

      <div className="card card-pad">
        <h2 className="card-title" style={{ marginBottom: 8 }}>
          Not wired up yet
        </h2>
        <p className="card-note" style={{ margin: 0, maxWidth: 620 }}>
          Send history lives on the Railway volume, in{" "}
          <code>runtime/cron-state/&lt;campaign&gt;/state.json</code> for what was delivered and{" "}
          <code>runtime/public-service-gate/ad-refs.json</code> for how many people replied to
          each ref code. Neither is readable from here until the console API is running beside
          the gateway, because the volume is attached to that one service and the console keeps
          no copy of its own.
        </p>
      </div>
    </Shell>
  );
}
