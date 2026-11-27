import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { ConsoleShell } from "@/app/_components/console-shell";
import { SessionBoundary } from "@/app/_components/session-boundary";
import { TimezoneProvider } from "@/app/_components/timezone-context";
import { PageHead } from "@/app/_components/ui";
import { displayTimezone } from "@/src/lib/display-timezone";
import type { Operator } from "@/src/lib/auth-types";
import { ONBOARDING_STEPS, ONBOARDING_STEP_LABEL, type OnboardingStep } from "@/src/domains/onboarding";
import { skipOnboardingAction } from "../actions";

/**
 * Every wizard step in the same frame: the console's sidebar with its nav held
 * back, where the steps stand, and a way out on every one of them. Skipping is
 * a form post, so it works before any script has loaded.
 */
export async function OnboardingFrame({ operator, step, title, subtitle, wide, children }: {
  operator: Operator; step: OnboardingStep;
  /** Left out where the step's own screen has its heading (the caption step). */
  title?: string; subtitle?: ReactNode;
  /** The campaign screens keep their own width rather than a settings column. */
  wide?: boolean;
  children: ReactNode;
}) {
  const zone = await displayTimezone();
  const at = ONBOARDING_STEPS.indexOf(step);
  return (
    <SessionBoundary uid={operator.uid}><TimezoneProvider zone={zone}>
      <ConsoleShell counts={{}} navDisabled operator={{ name: operator.name, meta: operator.email }}>
        <div className="onboarding-bar">
          <ol className="onboarding-steps" aria-label="Setup steps">
            <li className="onboarding-step is-done"><Check size={14} aria-hidden /> Sign up</li>
            {ONBOARDING_STEPS.map((each, index) => (
              <li key={each} aria-current={index === at ? "step" : undefined}
                className={`onboarding-step ${index < at ? "is-done" : index === at ? "is-current" : ""}`}>
                {index < at ? <Check size={14} aria-hidden /> : <span className="onboarding-step-number" aria-hidden>{index + 2}</span>}
                {ONBOARDING_STEP_LABEL[each]}
              </li>
            ))}
          </ol>
          <form action={skipOnboardingAction}><button type="submit" className="btn">Skip setup</button></form>
        </div>
        {title ? <PageHead title={title} subtitle={subtitle} /> : null}
        {wide ? children : <div className="settings-page">{children}</div>}
      </ConsoleShell>
    </TimezoneProvider></SessionBoundary>
  );
}
