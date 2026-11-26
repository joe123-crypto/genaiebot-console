import { requireOperator } from "@/src/lib/auth";
import { redirect } from "next/navigation";
import { ConsoleShell } from "@/app/_components/console-shell";
import { PageHead } from "@/app/_components/ui";
import { SessionBoundary } from "@/app/_components/session-boundary";
import { getWorkspace } from "@/src/lib/workspace";
import { BOT_PROVISIONING } from "@/src/config";
import { CreateBot } from "./create-bot";
import { DeleteAccountCard } from "@/app/settings/_components/delete-account-card";
import { botRemovalOf } from "@/src/lib/bot-teardown";

export const dynamic = "force-dynamic";

/**
 * Where a workspace without a bot lands. Every other page that reads the bot
 * sends it here first, so a new sign-up sees what it has rather than a page of
 * connection errors. This page makes no bot call at all: it has no bot to call.
 * Creating one is the only thing there is to do here, so it is the whole screen,
 * and the nav stays out of the way until there is something behind it.
 */
export default async function SetupPage() {
  const operator = await requireOperator();
  const workspace = await getWorkspace();
  if (workspace?.bot) redirect("/");
  const botRemoval = await botRemovalOf(workspace);
  const enabled = BOT_PROVISIONING !== "none";
  return (
    <SessionBoundary uid={operator.uid}><ConsoleShell counts={{}} navDisabled operator={{ name: operator.name, meta: operator.email }}>
      <PageHead
        title={enabled ? "Set up your bot" : "Your workspace"}
        subtitle="Your groups, campaigns and schedule will appear here once a bot is connected."
      />
      <div className="settings-page">
        <CreateBot
          workspace={{ id: workspace?.id ?? "", name: workspace?.name ?? "Workspace" }}
          enabled={enabled}
        />
        {/* Settings sits behind requireBot, which sends a workspace without one
            back here. Without this card the only way out of a workspace they
            do not want would be to ask an operator. */}
        <DeleteAccountCard email={operator.email} bot={botRemoval} />
      </div>
    </ConsoleShell></SessionBoundary>
  );
}
