import { Shell } from "@/app/_components/shell-wrapper";
import { BotError, Empty, PageHead } from "@/app/_components/ui";
import { CapSettingsForm } from "@/app/settings/_components/cap-settings-form";
import { getConfiguration, BotUnavailableError } from "@/src/lib/bot-client";
import { WRITES_ENABLED } from "@/src/config";
import { canWrite } from "@/src/lib/write-capabilities";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const loaded = await getConfiguration().then((overview) => ({ ok: true as const, overview }), (error: unknown) => {
    if (!(error instanceof BotUnavailableError)) throw error;
    return { ok: false as const, detail: error.detail };
  });
  if (!loaded.ok) {
    return (
      <Shell>
        <PageHead title="Settings" />
        <BotError detail={loaded.detail} />
      </Shell>
    );
  }
  const { capSettings, writes } = loaded.overview;

  return (
    <Shell>
      <PageHead title="Settings" subtitle="How many adverts each group gets a day." />
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
