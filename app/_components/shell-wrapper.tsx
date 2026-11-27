import { LiveShell } from "./live-shell";
import { TimezoneProvider } from "@/app/_components/timezone-context";
import type { ReactNode } from "react";
import { ConsoleShell } from "@/app/_components/console-shell";
import { attentionItems, needsDecisionCount, type Attention } from "@/src/domains/console";
import { BotUnavailableError, getNavigation, type NavigationPayload } from "@/src/lib/bot-client";
import type { Overview } from "@/src/lib/types";
import { requireOperator } from "@/src/lib/auth";
import { SessionBoundary } from "./session-boundary";
import { displayTimezone } from "@/src/lib/display-timezone";
import { getWorkspace, hasBot } from "@/src/lib/workspace";

/**
 * Every page renders inside the same frame. The counts and attention card come
 * from the bot, so when it is unreachable the frame still renders and the page
 * itself shows why. A workspace with no bot at all -- someone who skipped
 * onboarding -- asks it nothing, and the attention card says where to start.
 */
export async function Shell({ children, overview, summary, live, homeLayout, campaignsLayout, groupsLayout }: {
  children: ReactNode; overview?: Overview; summary?: NavigationPayload; live?: boolean; homeLayout?: boolean; campaignsLayout?: boolean; groupsLayout?: boolean;
}) {
  const user = await requireOperator();
  const operator = { name: user.name, meta: user.email };
  const zone = await displayTimezone();
  const workspace = await getWorkspace().catch(() => null);
  if (workspace && !hasBot(workspace)) {
    return <SessionBoundary uid={user.uid}><TimezoneProvider zone={zone}>
      <ConsoleShell counts={{}} attention={[{ label: "No bot yet", detail: "Set it up", href: "/setup" }]} operator={operator}
        homeLayout={homeLayout} campaignsLayout={campaignsLayout} groupsLayout={groupsLayout}>
        {children}
      </ConsoleShell>
    </TimezoneProvider></SessionBoundary>;
  }
  if (live) return <SessionBoundary uid={user.uid}><TimezoneProvider zone={zone}><LiveShell operator={operator} homeLayout={homeLayout} campaignsLayout={campaignsLayout} groupsLayout={groupsLayout}>{children}</LiveShell></TimezoneProvider></SessionBoundary>;
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
    <SessionBoundary uid={user.uid}><TimezoneProvider zone={zone}>
      <ConsoleShell
        counts={counts}
        attention={attention}
        operator={operator}
        homeLayout={homeLayout} campaignsLayout={campaignsLayout} groupsLayout={groupsLayout}
      >
        {children}
      </ConsoleShell>
    </TimezoneProvider></SessionBoundary>
  );
}
