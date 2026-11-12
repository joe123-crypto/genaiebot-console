import { Shell } from "@/app/_components/shell-wrapper";
import { PageHead } from "@/app/_components/ui";
import { LiveScheduleView } from "@/app/schedule/_components/live-schedule";
import { getLiveView } from "@/src/lib/live-client";
import { BotUnavailableError } from "@/src/lib/bot-client";
import { BOT_TIMEZONE, WRITES_ENABLED } from "@/src/config";
import type { LiveSchedule } from "@/src/lib/live-types";
export const dynamic = "force-dynamic";
export default async function ScheduleHomePage() {
  let initial: LiveSchedule | null = null;
  let initialError: string | undefined;
  try { initial = await getLiveView("schedule"); }
  catch (error) { if (!(error instanceof BotUnavailableError)) throw error; initialError = error.detail; }
  return <Shell live><PageHead subtitle={`The campaign day in ${BOT_TIMEZONE}. Live updates every 30 seconds.`} />
    <LiveScheduleView initial={initial} initialError={initialError} writable={WRITES_ENABLED} /></Shell>;
}
