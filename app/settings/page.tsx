import { requireOperator } from "@/src/lib/auth";
import { requireBot } from "@/src/lib/workspace";
import { Shell } from "@/app/_components/shell-wrapper";
import { BotError, Empty, PageHead } from "@/app/_components/ui";
import { CapSettingsForm } from "@/app/settings/_components/cap-settings-form";
import { DisplayTimezoneForm } from "@/app/settings/_components/display-timezone-form";
import { AppearanceForm } from "@/app/settings/_components/appearance-form";
import { DeleteAccountCard } from "@/app/settings/_components/delete-account-card";
import { botRemovalOf } from "@/src/lib/bot-teardown";
import { getLiveView } from "@/src/lib/live-client";
import type { ConfigurationPayload } from "@/src/lib/bot-client";
import { BotUnavailableError } from "@/src/lib/bot-client";
import { WRITES_ENABLED } from "@/src/config";
import { canWrite } from "@/src/lib/write-capabilities";
import { displayTimezone } from "@/src/lib/display-timezone";
import { displayTheme } from "@/src/lib/display-theme";

export const dynamic = "force-dynamic";

const SUBTITLE = "The clock the console is read on, light or dark, how many adverts each group gets a day, and deleting your account.";

export default async function SettingsPage() {
  const operator = await requireOperator();
  const workspace = await requireBot();
  const botRemoval = await botRemovalOf(workspace);
  const zone = await displayTimezone();
  const theme = await displayTheme();
  const loaded = await getLiveView<ConfigurationPayload>("settings").then((overview) => ({ ok: true as const, overview }), (error: unknown) => {
    if (!(error instanceof BotUnavailableError)) throw error;
    return { ok: false as const, detail: error.detail };
  });
  // The clock and the theme are the console's own settings, so they are offered
  // even when the bot cannot be reached for the caps beside them.
  if (!loaded.ok) {
    return (
      <Shell live>
        <PageHead title="Settings" subtitle={SUBTITLE} />
        <div className="settings-page">
          <DisplayTimezoneForm zone={zone} />
          <AppearanceForm theme={theme} />
          <BotError detail={loaded.detail} />
          <DeleteAccountCard email={operator.email} bot={botRemoval} />
        </div>
      </Shell>
    );
  }
  const { capSettings, writes } = loaded.overview;

  return (
    <Shell live>
      <PageHead title="Settings" subtitle={SUBTITLE} />
      <div className="settings-page">
        <DisplayTimezoneForm zone={zone} />
        <AppearanceForm theme={theme} />
        {capSettings ? (
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
        )}
        <DeleteAccountCard email={operator.email} bot={botRemoval} />
      </div>
    </Shell>
  );
}
