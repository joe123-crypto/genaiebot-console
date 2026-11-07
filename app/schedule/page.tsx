import { Shell } from "@/app/_components/shell-wrapper";
import { BotError, PageHead } from "@/app/_components/ui";
import { DayTimeline } from "@/app/schedule/_components/day-timeline";
import { daySlots, loadOverview } from "@/src/domains/console";
import { minutesOfDay } from "@/src/lib/format";
import { BOT_TIMEZONE } from "@/src/config";

export const dynamic = "force-dynamic";

/**
 * Dragging a bar is a real edit that cannot be written yet: the bot's config
 * writer takes campaign fields, but nothing installs a new cron from them. The
 * control is still worth having — it is how an operator finds a time that does
 * not clash — so it is offered with the save plainly switched off, the way a
 * caption save is when its bridge is missing.
 */
const SAVE_UNAVAILABLE =
  "Saving a new time is not connected to the bot yet. Drag to try a time out here, " +
  "then change the cron in genaebot's manifest.";

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

  return (
    <Shell>
      <PageHead
        title="Schedule"
        subtitle={`The campaign day in ${BOT_TIMEZONE}. Bars show each run's worst case, not its typical length.`}
      />
      <DayTimeline
        slots={daySlots(result.overview)}
        nowMinutes={nowMinutes}
        timezone={BOT_TIMEZONE}
        saveUnavailableReason={SAVE_UNAVAILABLE}
      />
    </Shell>
  );
}
