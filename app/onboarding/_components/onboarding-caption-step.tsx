"use client";

import { useRouter } from "next/navigation";
import { CampaignCaptionStep } from "@/app/campaigns/_components/campaign-caption-step";
import type { WriteGate } from "@/src/lib/write-capabilities";
import { completeOnboardingAction } from "../actions";

/**
 * The caption step, ending the wizard. A campaign whose schedule is still
 * pending stays on screen with its warning -- the wizard is over either way,
 * and the campaign link there now opens into the full console.
 */
export function OnboardingCaptionStep(props: { gate: WriteGate; loadError?: string; aiUnavailableReason?: string }) {
  const router = useRouter();
  return (
    <CampaignCaptionStep {...props} detailsHref="/onboarding/campaign" cancelHref="/onboarding/campaign"
      onCreated={async (_slug, pending) => {
        await completeOnboardingAction();
        if (!pending) { router.push("/"); router.refresh(); }
      }} />
  );
}
