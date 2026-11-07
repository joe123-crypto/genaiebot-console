import { AccountApiError, accountRequest, checkAccounts, checkLinkSession } from '@/src/lib/account-client';
import { ACCOUNT_WRITES_ENABLED } from '@/src/config';
import { ACCOUNT_ID } from '@/src/lib/account-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Context = { params: Promise<{ path?: string[] }> };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
function failure(error: unknown) {
  return error instanceof AccountApiError ? json({ error: error.message }, error.status) : json({ error: 'Account controls are unavailable. Refresh status before retrying.' }, 502);
}
export async function GET(_request: Request, context: Context) {
  const parts = (await context.params).path ?? [];
  if (!(parts.length === 0 || parts.length === 2 && parts[0] === 'link-sessions' && /^[a-f0-9-]{36}$/.test(parts[1]))) {
    return json({ error: 'Not found.' }, 404);
  }
  try {
    const value = await accountRequest(parts.length ? `/${parts.join('/')}` : '');
    return json(parts.length ? checkLinkSession(value) : checkAccounts(value));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  if (!ACCOUNT_WRITES_ENABLED) return json({ error: 'Account controls are read-only. Set CONSOLE_WRITES=1 and configure the live gateway API to enable account actions.' }, 403);
  // No login for the local-only console yet. Still refuse cross-site form/fetch
  // submissions so another website cannot trigger local account controls.
  const url = new URL(request.url);
  // Next can construct request.url with its internal bind hostname. Host is
  // the browser-facing authority, so localhost and 127.0.0.1 both work.
  const origin = `${url.protocol}//${request.headers.get('host') ?? url.host}`;
  if (request.headers.get('origin') !== origin ||
      request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Same-origin requests only.' }, 403);
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json({ error: 'Expected JSON.' }, 400);
  const parts = (await context.params).path ?? [];
  const action = parts[1];
  if (!(parts.length === 0 || parts.length === 2 && ACCOUNT_ID.test(parts[0]) && ['link', 'unlink', 'pause', 'start'].includes(action))) {
    return json({ error: 'Not found.' }, 404);
  }
  try {
    // Bound actual streamed bytes as Content-Length may be absent or dishonest.
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'Expected JSON.' }, 400);
    let text = '';
    let size = 0;
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) { await reader.cancel(); return json({ error: 'Request too large.' }, 413); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    let body: Record<string, unknown>;
    try { body = JSON.parse(text); } catch { return json({ error: 'Invalid JSON.' }, 400); }
    if (!body || Array.isArray(body) || typeof body !== 'object' ||
        (parts.length === 0 ? Object.keys(body).length !== 1 || typeof body.id !== 'string' || !ACCOUNT_ID.test(body.id) : Object.keys(body).length !== 0)) {
      return json({ error: 'Invalid account request.' }, 400);
    }
    const value = await accountRequest(parts.length ? `/${parts.join('/')}` : '', body);
    return json(parts.length === 0 || action === 'link' ? checkLinkSession(value) : checkAccounts(value));
  } catch (error) { return failure(error); }
}
