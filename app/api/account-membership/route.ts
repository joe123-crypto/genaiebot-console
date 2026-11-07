import { getGroups, getOverview } from '@/src/lib/bot-client';
import { lineSummaries } from '@/src/domains/console';

export const dynamic = 'force-dynamic';
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const [overview, membership] = await Promise.all([getOverview(), getGroups()]);
    return Response.json({ lines: lineSummaries(overview, membership.groups, membership.disabledPromos) }, { headers });
  } catch {
    return Response.json({ error: 'Configured group and campaign counts are unavailable.' }, { status: 503, headers });
  }
}
