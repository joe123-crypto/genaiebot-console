import { requireOperator } from "@/src/lib/auth";
import { redirect } from "next/navigation";
import { ConsoleShell } from "@/app/_components/console-shell";
import { PageHead } from "@/app/_components/ui";
import { SessionBoundary } from "@/app/_components/session-boundary";
import { getWorkspace } from "@/src/lib/workspace";

export const dynamic = "force-dynamic";

/**
 * Where a workspace without a bot lands. Every other page that reads the bot
 * sends it here first, so a new sign-up sees what it has rather than a page of
 * connection errors. This page makes no bot call at all: it has no bot to call.
 */
export default async function SetupPage() {
  const operator = await requireOperator();
  const workspace = await getWorkspace();
  if (workspace?.bot) redirect("/");
  return (
    <SessionBoundary uid={operator.uid}><ConsoleShell counts={{}} operator={{ name: operator.name, meta: operator.email }}>
      <PageHead title="Your workspace" subtitle="Your groups, campaigns and schedule will appear here once a bot is connected." />
      <section className="card card-pad">
        <h2 className="card-title">No bot connected yet</h2>
        <p className="card-note">
          Each workspace runs its own WhatsApp bot, and only you can see this workspace&apos;s data.
          Once your bot is set up and connected, this console shows its groups, campaigns, schedule and lines.
        </p>
        <dl className="card-note">
          <dt>Workspace</dt><dd>{workspace?.name}</dd>
          <dt>Workspace ID</dt><dd><code>{workspace?.id}</code></dd>
        </dl>
        <p className="card-note">Share the workspace ID with whoever is setting up your bot.</p>
      </section>
    </ConsoleShell></SessionBoundary>
  );
}
