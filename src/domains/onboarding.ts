/**
 * The first-run wizard: create the bot, link a WhatsApp number, make the first
 * campaign. Signing up is the Google sign-in that made the workspace, so it is
 * always done by the time anyone is here.
 *
 * Which step a user is on is worked out from what their workspace has, never
 * stored. A reload, a second tab, or coming back a week later lands on the
 * step that is actually next.
 */

export const ONBOARDING_STEPS = ["bot", "whatsapp", "campaign"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_STEP_LABEL: Record<OnboardingStep, string> = {
  bot: "Create your bot",
  whatsapp: "Connect WhatsApp",
  campaign: "Create a campaign",
};

export const onboardingPath = (step: OnboardingStep) => `/onboarding/${step}`;

/** What the workspace has. `connectedLines` is null when the bot could not say. */
export type OnboardingFacts = { hasBot: boolean; connectedLines: number | null };

/** Where `/onboarding` sends someone: the first step not yet done. */
export function onboardingStep({ hasBot, connectedLines }: OnboardingFacts): OnboardingStep {
  if (!hasBot) return "bot";
  return connectedLines ? "campaign" : "whatsapp";
}

/**
 * The furthest step that may be opened. An unanswered line count does not hold
 * anyone back: a bot that is briefly unreachable is no reason to throw someone
 * off the campaign step they were already on, and that step says so itself.
 */
export function furthestStep({ hasBot, connectedLines }: OnboardingFacts): OnboardingStep {
  if (!hasBot) return "bot";
  return connectedLines === 0 ? "whatsapp" : "campaign";
}

export function stepOpen(step: OnboardingStep, facts: OnboardingFacts): boolean {
  return ONBOARDING_STEPS.indexOf(step) <= ONBOARDING_STEPS.indexOf(furthestStep(facts));
}
