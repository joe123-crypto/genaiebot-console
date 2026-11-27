"use client";

import { CampaignCaptionStep } from "@/app/campaigns/_components/campaign-caption-step";
import type { WriteGate } from "@/src/lib/write-capabilities";
import type { CampaignRequirements } from "@/src/domains/campaign-create";
import { createOnboardingCampaignAction } from "../actions";

/**
 * The caption step, ending the wizard. The campaign is saved and onboarding
 * ended by the same request, so by the time it answers the wizard is over and
 * the dashboard is the place to be -- a schedule still pending included, which
 * the campaign itself goes on to show.
 *
 * A full load rather than a client navigation: the wizard's own pages redirect
 * on what they read, and a fresh page has no earlier navigation, or cached
 * answer from one, to land on instead of the dashboard.
 */
export function OnboardingCaptionStep(props: { gate: WriteGate; loadError?: string; aiUnavailableReason?: string; requirements?: CampaignRequirements }) {
  return (
    <CampaignCaptionStep {...props} detailsHref="/onboarding/campaign" cancelHref="/onboarding/campaign"
      createAction={createOnboardingCampaignAction}
      onCreated={() => { window.location.replace("/"); }} />
  );
}
