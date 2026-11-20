import { requireOperator } from "@/src/lib/auth";
import { ConsoleShell } from '@/app/_components/console-shell';
import { ACCOUNT_WRITES_ENABLED, WRITES_ENABLED } from '@/src/config';
import { SessionBoundary } from '@/app/_components/session-boundary';
import { AccountManager } from './account-manager';

export const dynamic = 'force-dynamic';

export default async function LinesPage() {
  const operator = await requireOperator();
  // Account controls must render even if the campaign/membership bridge stalls.
  // Both data sources load independently inside AccountManager.
  return (
    <SessionBoundary uid={operator.uid}><ConsoleShell counts={{}} operator={{ name: operator.name, meta: operator.email }}>
      <AccountManager writesEnabled={ACCOUNT_WRITES_ENABLED} configWrites={WRITES_ENABLED} />
    </ConsoleShell></SessionBoundary>
  );
}
