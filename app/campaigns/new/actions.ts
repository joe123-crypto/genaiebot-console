"use server";

import { requireOperator, auditActor } from "@/src/lib/auth";
import { revalidatePath } from "next/cache";
import { WRITES_ENABLED } from "@/src/config";
import { campaignCreateError, type NewCampaign, type CreateCampaignOutcome } from "@/src/domains/campaign-create";
import { createCampaign, getCapabilities, WriteRefusedError, WritesDisabledError } from "@/src/lib/bot-client";
import { canCreateInWorkspace } from "@/src/lib/write-capabilities";
import { keyPrefixOf } from "@/src/domains/campaign-create";
import { getWorkspace } from "@/src/lib/workspace";
import { failedWrite } from "@/src/lib/write-outcome";

export async function createCampaignAction(input: NewCampaign): Promise<CreateCampaignOutcome> {
  const operator = await requireOperator();
  if (!WRITES_ENABLED) return { ok: false, detail: "The console is in read-only mode.", outcome: "not-created" };
  const error = campaignCreateError(input);
  if (error) return { ok: false, detail: error, outcome: "not-created" };
  let submitted = false;
  try {
    const workspace = await getWorkspace();
    if (!workspace) return { ok: false, detail: "Sign in to continue.", outcome: "not-created" };
    const writes = await getCapabilities();
    const gate = canCreateInWorkspace(WRITES_ENABLED, writes, workspace.id);
    if (!gate.allowed) return { ok: false, detail: gate.reason, outcome: "not-created" };
    // The exact prefix this bot accepts; the shape check above allowed either.
    const prefixed = campaignCreateError(input, keyPrefixOf(writes));
    if (prefixed) return { ok: false, detail: prefixed, outcome: "not-created" };
    // The bot validates active membership inside its creation transaction.
    // Replays must reach its receipt even if a group changed after the save.
    submitted = true;
    const result = await createCampaign(input, { by: auditActor(operator) });
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
