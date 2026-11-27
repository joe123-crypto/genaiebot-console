import type { ReactNode } from "react";
import Image from "next/image";
import { Check } from "lucide-react";
import { PRODUCT_NAME } from "@/src/config";
import { SessionBoundary } from "@/app/_components/session-boundary";
import { SignOut } from "@/app/_components/sign-out";
import { TimezoneProvider } from "@/app/_components/timezone-context";
import { displayTimezone } from "@/src/lib/display-timezone";
import type { Operator } from "@/src/lib/auth-types";
import { ONBOARDING_STEPS, ONBOARDING_STEP_LABEL, type OnboardingStep } from "@/src/domains/onboarding";
import { skipOnboardingAction } from "../actions";

type FrameProps = {
  operator: Operator; step: OnboardingStep;
  /** Left out where the step's own screen has its heading (the caption step). */
  title?: string; subtitle?: ReactNode;
  /** A single card for the bot and WhatsApp steps; the campaign screens need
   *  the width their two-column forms are laid out for. */
  width?: "narrow" | "wide";
  children: ReactNode;
};

/**
 * Every wizard step in the same frame: a screen of its own, apart from the
 * console it leads into. The brand and a way to sign out across the top, where
 * the setup stands, the step centered beneath it, and a way out at the foot.
 */
export async function OnboardingFrame(props: FrameProps) {
  const zone = await displayTimezone();
  return (
    <SessionBoundary uid={props.operator.uid}><TimezoneProvider zone={zone}>
      <OnboardingLayout {...props} />
    </TimezoneProvider></SessionBoundary>
  );
}

/** Signing up is the Google sign-in that made the workspace, so it is always done. */
const STEPS = [{ key: "signup", label: "Sign up" }, ...ONBOARDING_STEPS.map((each) => ({ key: each, label: ONBOARDING_STEP_LABEL[each] }))];

/** The frame itself, with nothing to wait on, so it renders anywhere. */
export function OnboardingLayout({ operator, step, title, subtitle, width = "narrow", children }: FrameProps) {
  const at = ONBOARDING_STEPS.indexOf(step) + 1;
  const initial = operator.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="onboarding-app">
      <header className="onboarding-top">
        <span className="onboarding-brand">
          <Image className="onboarding-brand-mark" src="/logo.png" alt="" width={95} height={216} priority />
          <span>{PRODUCT_NAME}</span>
        </span>
        <div className="onboarding-account">
          <span className="onboarding-avatar" title={`${operator.name} · ${operator.email}`} aria-hidden>{initial}</span>
          <span className="sr-only">Signed in as {operator.name}, {operator.email}</span>
          <SignOut className="onboarding-sign-out" />
        </div>
      </header>

      <main className="onboarding-body">
        <nav className="onboarding-progress" aria-label="Setup progress">
          <p className="onboarding-progress-count" aria-hidden>Step {at + 1} of {STEPS.length} · {STEPS[at].label}</p>
          <ol className="onboarding-timeline">
            {STEPS.map((each, index) => {
              const state = index < at ? "is-done" : index === at ? "is-current" : "is-upcoming";
              return (
                <li key={each.key} className={`onboarding-stage ${state}`} aria-current={index === at ? "step" : undefined}>
                  <span className="onboarding-node" aria-hidden>
                    {index < at ? <Check size={14} strokeWidth={3} /> : index + 1}
                  </span>
                  <span className="onboarding-stage-label">
                    {each.label}
                    {index < at ? <span className="sr-only"> (done)</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>

        {title ? (
          <header className="onboarding-head">
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </header>
        ) : null}

        <div className={`onboarding-main is-${width}`}>{children}</div>

        <form action={skipOnboardingAction} className="onboarding-skip">
          <span>Not ready yet?</span>
          <button type="submit" className="onboarding-skip-button">Skip setup</button>
          <span>and set things up yourself from the console.</span>
        </form>
      </main>
    </div>
  );
}
