import { Shell } from "@/app/_components/shell-wrapper";
import { BotError, Empty, PageHead } from "@/app/_components/ui";
import { CapSettingsForm } from "@/app/settings/_components/cap-settings-form";
import { DisplayTimezoneForm } from "@/app/settings/_components/display-timezone-form";
import { getLiveView } from "@/src/lib/live-client";
import type { ConfigurationPayload } from "@/src/lib/bot-client";
import { BotUnavailableError } from "@/src/lib/bot-client";
import { WRITES_ENABLED } from "@/src/config";
import { canWrite } from "@/src/lib/write-capabilities";
import { displayTimezone } from "@/src/lib/display-timezone";

export const dynamic = "force-dynamic";

const SUBTITLE = "The clock the console is read on, and how many adverts each group gets a day.";

export default async function SettingsPage() {
  const zone = await displayTimezone();
  const loaded = await getLiveView<ConfigurationPayload>("settings").then((overview) => ({ ok: true as const, overview }), (error: unknown) => {
    if (!(error instanceof BotUnavailableError)) throw error;
    return { ok: false as const, detail: error.detail };
  });
  // The clock is the console's own setting, so it is offered even when the bot
  // cannot be reached for the caps beside it.
  if (!loaded.ok) {
    return (
      <Shell live>
        <PageHead title="Settings" subtitle={SUBTITLE} />
        <DisplayTimezoneForm zone={zone} />
        <BotError detail={loaded.detail} />
      </Shell>
    );
  }
  const { capSettings, writes } = loaded.overview;

  return (
    <Shell live>
      <PageHead title="Settings" subtitle={SUBTITLE} />
      <DisplayTimezoneForm zone={zone} />
      {capSettings ? (
        <CapSettingsForm
          settings={capSettings}
          gate={canWrite(WRITES_ENABLED, writes, "settings", "caps_enabled", "activity", "bands")}
        />
      ) : (
        <Empty>This bot predates cap settings in the console. Deploy a newer genaebot to see and change them here.</Empty>
      )}
    </Shell>
  );
}
