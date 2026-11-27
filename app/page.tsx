import { requireOperator } from "@/src/lib/auth";
import { hasBot, requireWorkspace } from "@/src/lib/workspace";
import { NoBotYet } from "@/app/_components/no-bot-yet";
import { Shell } from "@/app/_components/shell-wrapper";
import { PageHead } from "@/app/_components/ui";
import { LiveScheduleView } from "@/app/schedule/_components/live-schedule";
import { getLiveView } from "@/src/lib/live-client";
import { BotUnavailableError } from "@/src/lib/bot-client";
import { BOT_TIMEZONE, WRITES_ENABLED } from "@/src/config";
import { displayTimezone } from "@/src/lib/display-timezone";
import type { LiveSchedule } from "@/src/lib/live-types";
export const dynamic = "force-dynamic";
export default async function ScheduleHomePage() {
  await requireOperator();
  const workspace = await requireWorkspace();
  if (!hasBot(workspace)) return <Shell homeLayout><PageHead subtitle="The campaign day: what posts where, and when." />
    <NoBotYet title="Nothing scheduled yet">Your schedule appears here once you have a bot, a linked WhatsApp number and a campaign.
      Start with the bot.</NoBotYet></Shell>;
  let initial: LiveSchedule | null = null;
  let initialError: string | undefined;
  try { initial = await getLiveView("schedule"); }
  catch (error) { if (!(error instanceof BotUnavailableError)) throw error; initialError = error.detail; }
  const zone = await displayTimezone();
  // When the two differ, the day is still the bot's -- the clock is only ours.
  const day = zone === BOT_TIMEZONE ? `The campaign day in ${BOT_TIMEZONE}.`
    : `The campaign day, planned in ${BOT_TIMEZONE} and shown in ${zone}.`;
  return <Shell live homeLayout><PageHead subtitle={`${day} Live updates every 30 seconds.`} />
    <LiveScheduleView initial={initial} initialError={initialError} writable={WRITES_ENABLED} /></Shell>;
}
