import { requireOperator } from "@/src/lib/auth";
import { Shell } from "@/app/_components/shell-wrapper";
import { PageHead } from "@/app/_components/ui";
import { ACCOUNT_WRITES_ENABLED } from "@/src/config";
import { draftScope, hasBot, requireWorkspace } from "@/src/lib/workspace";
import { NoBotYet } from "@/app/_components/no-bot-yet";
import { customerBotRequest } from "@/src/lib/customer-bot-client";
import { CustomerBotEditor } from "./_components/customer-bot-editor";

export const dynamic = "force-dynamic";

export default async function CustomerBotPage() {
  await requireOperator();
  const workspace = await requireWorkspace();
  if (!hasBot(workspace)) return <Shell><PageHead title="Customer Bot" subtitle="How Genaie replies to customers on WhatsApp." />
    <NoBotYet title="No bot to reply yet">The Customer Bot is your bot&apos;s replies to customers. Create your bot to set them up.</NoBotYet></Shell>;
  const result = await customerBotRequest();
  // Drafts are keyed to this workspace's bot, so one can never publish to another.
  const target = draftScope(workspace);
  return (
    <Shell live>
      {/* The editor draws its own heading: its status and its actions live there. */}
      {result.kind === "live" ? (
        <CustomerBotEditor key={target} initial={result.live} writable={ACCOUNT_WRITES_ENABLED} draftKey={`genaie:customer-bot:v2:${target}`} />
      ) : (<>
        <PageHead title="Customer Bot" subtitle="How Genaie replies to customers on WhatsApp." />
        <section className="card card-pad">
          <h2 className="card-title">Customer Bot unavailable</h2>
          <p className="card-note">{result.kind === "error" ? result.detail : "The live content could not be loaded."}</p>
          <a className="btn" href="/customer-bot">Try again</a>
        </section>
      </>)}
    </Shell>
  );
}
