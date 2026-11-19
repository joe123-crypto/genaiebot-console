import { createHash } from "node:crypto";
import { Shell } from "@/app/_components/shell-wrapper";
import { PageHead } from "@/app/_components/ui";
import { ACCOUNT_WRITES_ENABLED, BOT_API_BASE_URL } from "@/src/config";
import { customerBotRequest } from "@/src/lib/customer-bot-client";
import { CustomerBotEditor } from "./_components/customer-bot-editor";

export const dynamic = "force-dynamic";

export default async function CustomerBotPage() {
  const result = await customerBotRequest();
  const target = createHash("sha256").update(BOT_API_BASE_URL.replace(/\/+$/, "")).digest("hex").slice(0, 16);
  return (
    <Shell live>
      <PageHead title="Customer Bot" subtitle="Manage how Genaie replies on WhatsApp and review the data sources it uses for current answers." />
      {result.kind === "live" ? (
        <CustomerBotEditor key={target} initial={result.live} writable={ACCOUNT_WRITES_ENABLED} draftKey={`genaie:customer-bot:v2:${target}`} />
      ) : (
        <section className="card card-pad">
          <h2 className="card-title">Customer Bot unavailable</h2>
          <p className="card-note">{result.kind === "error" ? result.detail : "The live content could not be loaded."}</p>
          <a className="btn" href="/customer-bot">Try again</a>
        </section>
      )}
    </Shell>
  );
}
