import { apiOperator } from "@/src/lib/auth";
import { NextResponse } from "next/server";
import { WRITES_ENABLED } from "@/src/config";
import { CAMPAIGN_SLUG, keyPrefixOf, uploadError } from "@/src/domains/campaign-create";
import { getWorkspace } from "@/src/lib/workspace";
import { getOverview, BotUnavailableError } from "@/src/lib/bot-client";
import { canCreateInWorkspace } from "@/src/lib/write-capabilities";
import { imageUploadConfigured, signCampaignUpload } from "@/src/lib/campaign-upload";

export async function POST(request: Request) {
  const operator = await apiOperator();
  if (operator instanceof Response) return operator;
  const refuse = (error: string, status = 400) => NextResponse.json({ error }, { status });
  if (!WRITES_ENABLED) return refuse("The console is in read-only mode.", 403);
  const url = new URL(request.url);
  // Next can normalize the URL to its internal bind hostname. Host retains
  // the authority the browser used, including its port.
  const expectedOrigin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  const origin = request.headers.get("origin");
  if (origin !== expectedOrigin || request.headers.get("sec-fetch-site") === "cross-site") return refuse("Cross-origin uploads are not allowed.", 403);
  if (!imageUploadConfigured()) return refuse("Picture upload storage is not configured on the console.", 503);
  if (Number(request.headers.get("content-length")) > 4096) return refuse("Upload metadata is too large.");
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 4096) return refuse("Upload metadata is too large.");
    const { slug, image } = JSON.parse(raw);
    if (typeof slug !== "string" || !CAMPAIGN_SLUG.test(slug)) return refuse("Enter a valid campaign name first.");
    const error = uploadError(image, slug);
    if (error) return refuse(error);
    const workspace = await getWorkspace();
    if (!workspace) return refuse("Sign in to continue.", 401);
    const overview = await getOverview(undefined, { fresh: true });
    const gate = canCreateInWorkspace(WRITES_ENABLED, overview.writes, workspace.id);
    if (!gate.allowed) return refuse(gate.reason, 403);
    // Signed only under the prefix this workspace's bot names: never another's.
    const placed = uploadError(image, slug, keyPrefixOf(overview.writes));
    if (placed) return refuse(placed);
    if (overview.deletedCampaigns?.includes(slug) || overview.campaigns?.some((campaign) => campaign.slug === slug)) {
      return refuse("This campaign ID is already in use or has been deleted. Choose a different name.", 409);
    }
    return NextResponse.json(await signCampaignUpload(image), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) return refuse("Upload metadata could not be read.");
    if (error instanceof BotUnavailableError) return refuse(error.detail, error.status === 409 ? 409 : 503);
    return refuse("The upload URL could not be prepared. Try again.", 503);
  }
}
