import { requireOperator } from "@/src/lib/auth";
import { hasBot, requireWorkspace } from "@/src/lib/workspace";
import { NoBotYet } from "@/app/_components/no-bot-yet";
import { Shell } from "@/app/_components/shell-wrapper";
import type { ReactNode } from "react";
import { BotError, Empty, PageHead, Section } from "@/app/_components/ui";
import { SettingsGroup } from "@/app/_components/settings-group";
import { CapSettingsForm } from "@/app/settings/_components/cap-settings-form";
import { DisplayTimezoneForm } from "@/app/settings/_components/display-timezone-form";
import { AppearanceForm } from "@/app/settings/_components/appearance-form";
import { getLiveView } from "@/src/lib/live-client";
import type { ConfigurationPayload } from "@/src/lib/bot-client";
import { BotUnavailableError } from "@/src/lib/bot-client";
import { BOT_TIMEZONE, WRITES_ENABLED } from "@/src/config";
import { canWrite } from "@/src/lib/write-capabilities";
import { displayTimezone } from "@/src/lib/display-timezone";
import { displayTheme } from "@/src/lib/display-theme";

export const dynamic = "force-dynamic";

const SUBTITLE = "How the console looks to you, and how many adverts each group gets.";

const DISPLAY_NOTE = `What you see in this browser. Campaigns still go out on ${BOT_TIMEZONE} time, and your other devices keep their own choice.`;
const CAPS_NOTE = "How many adverts each group gets a day. A group's tier sets its range, and when more campaigns target it than it allows, they take turns.";

export default async function SettingsPage() {
  // Kept first, and bare: every page must deny an unauthenticated request
  // before it reads anything (tests/auth-coverage).
  await requireOperator();
  const workspace = await requireWorkspace();
  const zone = await displayTimezone();
  const theme = await displayTheme();

  // The clock and the theme are the console's own settings, so they are
  // offered even without a bot, or when it cannot be reached for the caps.
  const page = (caps: ReactNode, live: boolean) => (
    <Shell live={live}>
      <PageHead title="Settings" subtitle={SUBTITLE} />
      <div className="settings-page">
        <SettingsGroup id="display" title="Display" description={DISPLAY_NOTE}>
          <Section className="settings-card">
            <DisplayTimezoneForm zone={zone} />
            <AppearanceForm theme={theme} />
          </Section>
        </SettingsGroup>
        <SettingsGroup id="caps" title="Daily caps" description={CAPS_NOTE}>{caps}</SettingsGroup>
      </div>
    </Shell>
  );

  // Without a bot there are no caps to set, but the console's own settings
  // are still this user's to use.
  if (!hasBot(workspace)) {
    return page(<NoBotYet title="No bot yet">How many adverts each group gets a day is a setting of your bot. Create it to set these.</NoBotYet>, false);
  }
  const loaded = await getLiveView<ConfigurationPayload>("settings").then((overview) => ({ ok: true as const, overview }), (error: unknown) => {
    if (!(error instanceof BotUnavailableError)) throw error;
    return { ok: false as const, detail: error.detail };
  });
  if (!loaded.ok) return page(<BotError detail={loaded.detail} />, true);

  const { capSettings, writes } = loaded.overview;
  return page(capSettings ? (
    <CapSettingsForm
      settings={capSettings}
      gate={canWrite(WRITES_ENABLED, writes, "settings", "caps_enabled", "activity", "bands")}
      /* Gated on its own: a bot that predates the rotation switch refuses
         the field by name, and that must disable one checkbox rather than
         the whole form. */
      rotationGate={canWrite(WRITES_ENABLED, writes, "settings", "rotation_enabled")}
    />
  ) : (
    <Empty>This bot predates cap settings in the console. Deploy a newer genaebot to see and change them here.</Empty>
  ), true);
}
