import { ConsoleShell } from '@/app/_components/console-shell';
import { ACCOUNT_WRITES_ENABLED, OPERATOR_NAME, WRITES_ENABLED } from '@/src/config';
import { AccountManager } from './account-manager';

export const dynamic = 'force-dynamic';

export default function LinesPage() {
  // Account controls must render even if the campaign/membership bridge stalls.
  // Both data sources load independently inside AccountManager.
  return (
    <ConsoleShell counts={{}} operator={{ name: OPERATOR_NAME, meta: 'Operator' }}>
      <AccountManager writesEnabled={ACCOUNT_WRITES_ENABLED} configWrites={WRITES_ENABLED} />
    </ConsoleShell>
  );
}
