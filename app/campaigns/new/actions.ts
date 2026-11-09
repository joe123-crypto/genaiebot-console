"use server";
import { revalidatePath } from "next/cache";
import { WRITES_ENABLED } from "@/src/config";
import { campaignCreateError, type NewCampaign, type CreateCampaignOutcome } from "@/src/domains/campaign-create";
import { createCampaign, getOverview, WriteRefusedError, WritesDisabledError } from "@/src/lib/bot-client";
import { canCreateCampaign } from "@/src/lib/write-capabilities";
import { failedWrite } from "@/src/lib/write-outcome";

export async function createCampaignAction(input: NewCampaign): Promise<CreateCampaignOutcome> {
  if (!WRITES_ENABLED) return { ok: false, detail: "The console is in read-only mode.", outcome: "not-created" };
  const error = campaignCreateError(input);
  if (error) return { ok: false, detail: error, outcome: "not-created" };
  let submitted = false;
  try {
    const overview = await getOverview();
    const gate = canCreateCampaign(WRITES_ENABLED, overview.writes);
    if (!gate.allowed) return { ok: false, detail: gate.reason, outcome: "not-created" };
    // The bot validates active membership inside its creation transaction.
    // Replays must reach its receipt even if a group changed after the save.
    submitted = true;
    const result = await createCampaign(input);
    for (const route of ["/campaigns", `/campaigns/${result.slug}`, "/groups", "/schedule", "/"]) revalidatePath(route);
    return { ok: true, ...result };
  } catch (error) {
    const failure = failedWrite(error) as Extract<ReturnType<typeof failedWrite>, { ok: false }>;
    // A 5xx refusal can follow an uncertain Firestore commit. Only preflight
    // failures and explicit client refusals prove this attempt created nothing.
    const refused = error instanceof WritesDisabledError ||
      (error instanceof WriteRefusedError && error.status >= 400 && error.status < 500);
    return { ...failure, outcome: submitted && !refused ? "unknown" : "not-created" };
  }
}
