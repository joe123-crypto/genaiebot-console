import { LiveShell } from "./live-shell";
import { TimezoneProvider } from "@/app/_components/timezone-context";
import type { ReactNode } from "react";
import { ConsoleShell } from "@/app/_components/console-shell";
import { attentionItems, needsDecisionCount, type Attention } from "@/src/domains/console";
import { BotUnavailableError, getNavigation, type NavigationPayload } from "@/src/lib/bot-client";
import type { Overview } from "@/src/lib/types";
import { OPERATOR_NAME } from "@/src/config";
import { displayTimezone } from "@/src/lib/display-timezone";

/**
 * Every page renders inside the same frame. The counts and attention card come
 * from the bot, so when it is unreachable the frame still renders and the page
 * itself shows why.
 */
export async function Shell({ children, overview, summary, live }: { children: ReactNode; overview?: Overview; summary?: NavigationPayload; live?: boolean }) {
  const zone = await displayTimezone();
  if (live) return <TimezoneProvider zone={zone}><LiveShell operator={{ name: OPERATOR_NAME, meta: "Operator" }}>{children}</LiveShell></TimezoneProvider>;
  let counts: { campaigns?: number; groupsNeedingReview?: number } = {};
  let attention: Attention[] = [];
  if (overview) {
    counts = { campaigns: overview.campaignTotal, groupsNeedingReview: needsDecisionCount(overview) };
    attention = attentionItems(overview);
  } else if (summary) {
    counts = { campaigns: summary.campaignTotal, groupsNeedingReview: summary.groupsNeedingReview };
    if (summary.groupsNeedingReview) attention = [{ label: "Groups needing a decision", detail: String(summary.groupsNeedingReview), href: "/groups?status=needs-decision" }];
  } else {
    try {
      const summary = await getNavigation();
      counts = { campaigns: summary.campaignTotal, groupsNeedingReview: summary.groupsNeedingReview };
      if (summary.groupsNeedingReview) attention = [{ label: "Groups needing a decision", detail: String(summary.groupsNeedingReview), href: "/groups?status=needs-decision" }];
    } catch (error) {
      if (!(error instanceof BotUnavailableError)) throw error;
      attention = [{ label: "Cannot reach the bot" }];
    }
  }

  return (
    <TimezoneProvider zone={zone}>
      <ConsoleShell
        counts={counts}
        attention={attention}
        operator={{ name: OPERATOR_NAME, meta: "Operator" }}
      >
        {children}
      </ConsoleShell>
    </TimezoneProvider>
  );
}
