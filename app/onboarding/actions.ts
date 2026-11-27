"use server";

import { redirect } from "next/navigation";
import { requireOperator } from "@/src/lib/auth";
import { finishOnboarding } from "@/src/lib/workspace";
import { createCampaignAction } from "@/app/campaigns/new/actions";
import type { CreateCampaignOutcome, NewCampaign } from "@/src/domains/campaign-create";

/**
 * Leave the wizard for good. Nothing is made on the way out: whatever the user
 * had done stays, and the rest they set up from each page in its usual place.
 */
export async function skipOnboardingAction(): Promise<void> {
  await requireOperator();
  await finishOnboarding("skipped");
  redirect("/");
}

/**
 * The wizard's last step: the campaign, and the end of onboarding with it, in
 * one request. Ending it in a second request left a gap where anything that
 * read the workspace -- the page re-rendered by the campaign's revalidation,
 * the dashboard being opened -- still saw onboarding open, and sent the user
 * back to the campaign details. A failure to record it fails the request, so
 * the step's retry, which replays the same campaign, records it again.
 */
export async function createOnboardingCampaignAction(input: NewCampaign): Promise<CreateCampaignOutcome> {
  const result = await createCampaignAction(input);
  if (result.ok) await finishOnboarding("done");
  return result;
}
