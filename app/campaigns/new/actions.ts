"use server";
import { revalidatePath } from "next/cache";
import { WRITES_ENABLED } from "@/src/config";
import { campaignCreateError, type NewCampaign, type CreateCampaignOutcome } from "@/src/domains/campaign-create";
import { createCampaign, getOverview } from "@/src/lib/bot-client";
import { canCreateCampaign } from "@/src/lib/write-capabilities";
import { failedWrite } from "@/src/lib/write-outcome";

export async function createCampaignAction(input: NewCampaign): Promise<CreateCampaignOutcome> {
  if (!WRITES_ENABLED) return { ok: false, detail: "The console is in read-only mode." };
  const error = campaignCreateError(input);
  if (error) return { ok: false, detail: error };
  try {
    const overview = await getOverview();
    const gate = canCreateCampaign(WRITES_ENABLED, overview.writes);
    if (!gate.allowed) return { ok: false, detail: gate.reason };
    // The bot validates active membership inside its creation transaction.
    // Replays must reach its receipt even if a group changed after the save.
    const result = await createCampaign(input);
    for (const route of ["/campaigns", `/campaigns/${result.slug}`, "/groups", "/schedule", "/"]) revalidatePath(route);
    return { ok: true, ...result };
  } catch (error) { return failedWrite(error) as Extract<CreateCampaignOutcome, { ok: false }>; }
}
