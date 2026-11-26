import "server-only";

/**
 * Talking to Railway's public API, and nothing else.
 *
 * One transport, one error type. This module knows nothing about bots or
 * workspaces: what each call means lives in `railway-bot`, so the shape of a
 * GraphQL request is in one place and the feature's vocabulary is in another.
 *
 * Railway's own words never reach the browser. A failure here carries two
 * strings: `detail`, which is ours and is safe to show, and `upstream`, which is
 * Railway's and is for the server log. That is the same rule `bot-client`
 * follows for the bot's error bodies, and it matters more here -- a GraphQL
 * error can quote the request, and the request can hold a token.
 */

export const RAILWAY_API_URL = "https://backboard.railway.com/graphql/v2";
const TIMEOUT_MS = 20_000;

export class RailwayError extends Error {
  readonly detail: string;
  /** Railway's own words. Logged, never sent to a browser: the provisioner's
   *  `logFailure` (`bot-provisioning-railway`) is what writes it down. */
  readonly upstream: string;
  constructor(detail: string, upstream = "") {
    super(detail);
    this.name = "RailwayError";
    this.detail = detail;
    this.upstream = upstream.slice(0, 400);
  }
}

/** Railway's errors can quote the document and its variables, and a variable
 *  can be a token. Nothing is kept but the message, and only up to 400 chars. */
function upstreamOf(errors: unknown): string {
  if (!Array.isArray(errors)) return "";
  return errors
    .map((error) => (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message : ""))
    .filter(Boolean).join("; ").slice(0, 400);
}

/**
 * One GraphQL call. `guard` is the caller's own check on `data`: an answer this
 * console cannot read is a failure, never a value to carry on with.
 */
export async function railwayRequest<T>(
  token: string,
  document: string,
  variables: Record<string, unknown>,
  guard: (data: unknown) => T | null,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(RAILWAY_API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json",
                 authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: document, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new RailwayError("Your bot's hosting could not be reached. Try again shortly.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new RailwayError("This console's hosting credentials were refused, so no bot could be created.");
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = null; }
  const errors = (body as { errors?: unknown } | null)?.errors;
  if (!response.ok || errors) {
    throw new RailwayError("Your bot's hosting refused a step of the setup.", upstreamOf(errors));
  }
  const checked = guard((body as { data?: unknown } | null)?.data);
  if (checked === null) throw new RailwayError("Your bot's hosting gave an answer this console could not read.");
  return checked;
}

/** The guards below are the house style: a shape we recognise, or null. */
export const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= 200 ? value : null;

export function field(data: unknown, name: string): unknown {
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)[name] : undefined;
}
