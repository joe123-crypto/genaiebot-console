import type { ReactNode } from "react";
import { ConsoleShell } from "@/app/_components/console-shell";
import { attentionItems, loadOverview, needsDecisionCount } from "@/src/domains/console";
import { OPERATOR_NAME } from "@/src/config";

/**
 * Every page renders inside the same frame. The counts and attention card come
 * from the bot, so when it is unreachable the frame still renders and the page
 * itself shows why.
 */
export async function Shell({ children }: { children: ReactNode }) {
  const result = await loadOverview();

  const counts = result.ok
    ? {
        campaigns: result.overview.campaignTotal,
        groupsNeedingReview: needsDecisionCount(result.overview),
      }
    : {};

  const attention = result.ok
    ? attentionItems(result.overview)
    : [{ label: "Cannot reach the bot" }];

  return (
    <ConsoleShell
      counts={counts}
      attention={attention}
      operator={{ name: OPERATOR_NAME, meta: "Operator" }}
    >
      {children}
    </ConsoleShell>
  );
}
