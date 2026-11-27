import { requireOnboarding } from "@/src/lib/onboarding";

export const dynamic = "force-dynamic";

/** The wizard's front door: always a redirect, to the step that is next. */
export default async function OnboardingPage() {
  await requireOnboarding();
  return null;
}
