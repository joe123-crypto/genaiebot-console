"use server";

import { redirect } from "next/navigation";
import { requireOperator } from "@/src/lib/auth";
import { finishOnboarding } from "@/src/lib/workspace";

/**
 * Leave the wizard for good. Nothing is made on the way out: whatever the user
 * had done stays, and the rest they set up from each page in its usual place.
 */
export async function skipOnboardingAction(): Promise<void> {
  await requireOperator();
  await finishOnboarding("skipped");
  redirect("/");
}

/** The last step is behind them. The caller decides where to go next. */
export async function completeOnboardingAction(): Promise<void> {
  await requireOperator();
  await finishOnboarding("done");
}
