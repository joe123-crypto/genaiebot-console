import { apiOperator } from "@/src/lib/auth";
import { getLiveView } from '@/src/lib/live-client';
export const dynamic = 'force-dynamic';
export async function GET() {
  const operator = await apiOperator();
  if (operator instanceof Response) return operator;
  const headers = { 'Cache-Control': 'no-store' };
  try { return Response.json(await getLiveView('lines'), { headers }); }
  catch { return Response.json({ error: 'Configured group and campaign counts are unavailable.' }, { status: 503, headers }); }
}
