import "server-only";
import { redirect } from "next/navigation";
import { requireOperator } from "./auth";
import type { Operator } from "./auth-types";
import { connectedAccounts } from "./account-client";
import { botTarget, getWorkspace, hasBot, type Workspace } from "./workspace";
import { onboardingPath, onboardingStep, stepOpen, type OnboardingFacts, type OnboardingStep } from "@/src/domains/onboarding";

/** What the wizard needs to know to place someone. One bot call at most. */
export async function onboardingFacts(workspace: Workspace): Promise<OnboardingFacts> {
  if (!hasBot(workspace)) return { hasBot: false, connectedLines: 0 };
  try { return { hasBot: true, connectedLines: (await connectedAccounts(await botTarget())).length }; }
  catch { return { hasBot: true, connectedLines: null }; }
}

/**
 * The gate on every wizard page. Onboarding that has ended -- skipped or done
 * -- is never shown again, and a step ahead of what the workspace has goes
 * back to the one that is next.
 */
export async function requireOnboarding(step?: OnboardingStep): Promise<{ operator: Operator; workspace: Workspace; facts: OnboardingFacts }> {
  const operator = await requireOperator();
  const workspace = await getWorkspace();
  if (!workspace) redirect("/login");
  if (workspace.onboarding !== "pending") redirect("/");
  // The bot step needs nothing from the bot, so it makes no call.
  const facts = step === "bot" ? { hasBot: hasBot(workspace), connectedLines: null } : await onboardingFacts(workspace);
  if (!step) redirect(onboardingPath(onboardingStep(facts)));
  if (!stepOpen(step, facts)) redirect(onboardingPath(onboardingStep(facts)));
  return { operator, workspace, facts };
}
