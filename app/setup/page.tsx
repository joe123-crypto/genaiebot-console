import { requireOperator } from "@/src/lib/auth";
import { redirect } from "next/navigation";
import { Shell } from "@/app/_components/shell-wrapper";
import { PageHead } from "@/app/_components/ui";
import { hasBot, requireWorkspace } from "@/src/lib/workspace";
import { BOT_PROVISIONING } from "@/src/config";
import { CreateBot } from "./create-bot";
import { DeleteAccountCard } from "@/app/settings/_components/delete-account-card";
import { botRemovalOf } from "@/src/lib/bot-teardown";

export const dynamic = "force-dynamic";

/**
 * Where a workspace without a bot creates one, outside the wizard: a user who
 * skipped onboarding comes here from any page that needs a bot. A new user is
 * still in the wizard, which has its own bot step, so they go there instead.
 * This page makes no bot call at all: it has no bot to call.
 */
export default async function SetupPage() {
  const operator = await requireOperator();
  const workspace = await requireWorkspace();
  if (hasBot(workspace)) redirect("/");
  const botRemoval = await botRemovalOf(workspace);
  const enabled = BOT_PROVISIONING !== "none";
  return (
    <Shell>
      <PageHead
        title={enabled ? "Set up your bot" : "Your workspace"}
        subtitle="Your groups, campaigns and schedule will appear once a bot is connected."
      />
      <div className="settings-page">
        <CreateBot workspace={{ id: workspace.id, name: workspace.name }} enabled={enabled} />
        <DeleteAccountCard email={operator.email} bot={botRemoval} />
      </div>
    </Shell>
  );
}
