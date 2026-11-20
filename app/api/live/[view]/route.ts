import { apiOperator } from "@/src/lib/auth";
import { getLiveView } from "@/src/lib/live-client";
import { BotUnavailableError } from "@/src/lib/bot-client";
export const dynamic = "force-dynamic";
const views = new Set(["groups", "campaigns", "discoveries", "metrics", "schedule", "settings", "lines", "navigation", "campaign", "campaign-clicks", "captions", "detail", "preview", "group"]);
export async function GET(request: Request, { params }: { params: Promise<{ view: string }> }) {
  const operator = await apiOperator();
  if (operator instanceof Response) return operator;
  const { view } = await params;
  const headers = { "Cache-Control": "no-store" };
  if (!views.has(view)) return Response.json({ error: "Unknown live view." }, { status: 404, headers });
  try { return Response.json(await getLiveView(view, new URL(request.url).searchParams), { headers }); }
  catch (error) {
    if (!(error instanceof BotUnavailableError)) throw error;
    // Only the session guard may return 401. A rejected server-to-bot token is
    // an upstream failure; treating it as logout would create a login loop.
    const status = error.status === 401 || error.status === 403 ? 502 : error.status === 404 ? 503 : error.status ?? 503;
    return Response.json({ error: error.detail }, { status, headers });
  }
}
