import { Shell } from "@/app/_components/shell-wrapper";
import { BotError, PageHead } from "@/app/_components/ui";
import { DayTimeline } from "@/app/schedule/_components/day-timeline";
import { daySlots, loadOverview } from "@/src/domains/console";
import { minutesOfDay } from "@/src/lib/format";
import { BOT_TIMEZONE, WRITES_ENABLED } from "@/src/config";
import { canEditSchedule } from "@/src/lib/write-capabilities";

export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const result = await loadOverview();

  if (!result.ok) {
    return (
      <Shell>
        <PageHead title="Schedule" />
        <BotError detail={result.detail} />
      </Shell>
    );
  }

  /**
   * The clock is the one thing on this screen that is not genaebot's own state,
   * so it is read here, per render. The console already refreshes every 60s,
   * which is what moves the marker; the sidebar says when that has paused.
   */
  const nowMinutes = minutesOfDay(new Date());
  const gate = canEditSchedule(WRITES_ENABLED, result.overview.writes);

  return (
    <Shell overview={result.overview}>
      <PageHead
        title="Schedule"
        subtitle={`The campaign day in ${BOT_TIMEZONE}. Bars show each run's worst case, not its typical length.`}
      />
      <DayTimeline
        slots={daySlots(result.overview)}
        nowMinutes={nowMinutes}
        timezone={BOT_TIMEZONE}
        date={result.overview.date}
        saveUnavailableReason={gate.allowed ? undefined : gate.reason}
      />
    </Shell>
  );
}
