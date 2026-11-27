import { requireOperator } from "@/src/lib/auth";
import { hasBot, requireWorkspace } from "@/src/lib/workspace";
import { Shell } from "@/app/_components/shell-wrapper";
import { PageHead } from "@/app/_components/ui";
import { NoBotYet } from "@/app/_components/no-bot-yet";
import { ConsoleShell } from '@/app/_components/console-shell';
import { ACCOUNT_WRITES_ENABLED, WRITES_ENABLED } from '@/src/config';
import { SessionBoundary } from '@/app/_components/session-boundary';
import { AccountManager } from './account-manager';

export const dynamic = 'force-dynamic';

export default async function LinesPage() {
  const operator = await requireOperator();
  const workspace = await requireWorkspace();
  if (!hasBot(workspace)) return <Shell><PageHead title="WhatsApp lines" subtitle="Connect WhatsApp accounts and control when each line runs." />
    <NoBotYet title="No WhatsApp lines yet">A line is a WhatsApp number your bot posts from, so it links to your bot. Create your
      bot first, then add your first line here.</NoBotYet></Shell>;
  // Account controls must render even if the campaign/membership bridge stalls.
  // Both data sources load independently inside AccountManager.
  return (
    <SessionBoundary uid={operator.uid}><ConsoleShell counts={{}} operator={{ name: operator.name, meta: operator.email }}>
      <AccountManager writesEnabled={ACCOUNT_WRITES_ENABLED} configWrites={WRITES_ENABLED} />
    </ConsoleShell></SessionBoundary>
  );
}
