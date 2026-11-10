import { getLiveView } from "@/src/lib/live-client";
import { BotUnavailableError } from "@/src/lib/bot-client";
export const dynamic = "force-dynamic";
const views = new Set(["groups", "campaigns", "discoveries", "metrics", "schedule", "navigation", "campaign", "detail", "preview", "group"]);
export async function GET(request: Request, { params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  const headers = { "Cache-Control": "no-store" };
  if (!views.has(view)) return Response.json({ error: "Unknown live view." }, { status: 404, headers });
  try { return Response.json(await getLiveView(view, new URL(request.url).searchParams), { headers }); }
  catch (error) {
    if (!(error instanceof BotUnavailableError)) throw error;
    return Response.json({ error: error.detail }, { status: error.status === 404 ? 503 : error.status ?? 503, headers });
  }
}
