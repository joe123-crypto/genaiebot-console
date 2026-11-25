import { apiOperator } from "@/src/lib/auth";
import { BotConnectError } from "@/src/lib/bot-connect";
import { BotUnavailableError } from "@/src/lib/bot-errors";
import { provisioningEnabled, readProvisionState, startProvisioning } from "@/src/lib/bot-provisioning";
import { getWorkspace } from "@/src/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Creating this workspace's bot: what a run has reached, and starting one.
 *
 * Which workspace is never asked for. It is the signed-in user's own, resolved
 * on the server, so this route cannot be pointed at anybody else's.
 */

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

function failure(error: unknown) {
  if (error instanceof BotUnavailableError) return json({ error: error.detail }, error.status ?? 503);
  // A refused handshake is not a BotUnavailableError, so without this it would
  // read as "something broke" when in fact the bot answered and was turned down.
  // Its message is this console's own words, which is why it can be shown.
  if (error instanceof BotConnectError) return json({ error: error.message }, 409);
  return json({ error: "Your bot's setup could not be read. Try again shortly." }, 502);
}

/** The workspace, or the answer to send instead. A workspace that already has
 *  a bot is not an error here: it is a finished run, which is what the caller
 *  polling this is waiting to be told. */
async function target() {
  const workspace = await getWorkspace();
  if (!workspace) return json({ error: "Sign in to continue." }, 401);
  return workspace;
}

export async function GET() {
  const operator = await apiOperator();
  if (operator instanceof Response) return operator;
  if (!provisioningEnabled()) return json({ error: "Creating a bot from the console is not available yet." }, 503);
  try {
    const workspace = await target();
    if (workspace instanceof Response) return workspace;
    return json(await readProvisionState(workspace));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const operator = await apiOperator();
  if (operator instanceof Response) return operator;
  if (!provisioningEnabled()) return json({ error: "Creating a bot from the console is not available yet." }, 503);
  // A session does not authorize cross-site submissions.
  const url = new URL(request.url);
  // Next can construct request.url with its internal bind hostname. Host is
  // the browser-facing authority, so localhost and 127.0.0.1 both work.
  const origin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (request.headers.get("origin") !== origin ||
      request.headers.get("sec-fetch-site") === "cross-site") return json({ error: "Same-origin requests only." }, 403);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return json({ error: "Expected JSON." }, 400);
  }
  try {
    // Bound actual streamed bytes as Content-Length may be absent or dishonest.
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "Expected JSON." }, 400);
    let text = "";
    let size = 0;
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) { await reader.cancel(); return json({ error: "Request too large." }, 413); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    let body: unknown;
    try { body = JSON.parse(text); } catch { return json({ error: "Invalid JSON." }, 400); }
    // Starting a run takes no arguments: there is one bot a workspace can have.
    if (!body || Array.isArray(body) || typeof body !== "object" || Object.keys(body).length !== 0) {
      return json({ error: "Invalid setup request." }, 400);
    }
    const workspace = await target();
    if (workspace instanceof Response) return workspace;
    return json(await startProvisioning(workspace));
  } catch (error) { return failure(error); }
}
