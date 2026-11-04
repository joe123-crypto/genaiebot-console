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
          Not built yet
        </h2>
        <p className="card-note" style={{ margin: 0, maxWidth: 620 }}>
          Send history lives on the Railway volume, in{" "}
          <code>runtime/cron-state/&lt;campaign&gt;/state.json</code> for what was delivered and{" "}
          <code>runtime/public-service-gate/ad-refs.json</code> for how many people replied to
          each ref code. The console API runs on the service that volume is attached to, so
          both are now within reach — what is missing is an <code>activity</code> subcommand
          on the read bridge, which today answers only overview, groups, campaigns and
          preview, and a route to serve it. Nothing is blocking it; it simply has not been
          written.
        </p>
      </div>
    </Shell>
  );
}
