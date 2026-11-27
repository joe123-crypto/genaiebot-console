import { BotUnavailableError } from './bot-errors';
import { botTarget, type BotTarget } from './workspace';
import type { AccountsPayload, LinkSession } from './account-types';

export class AccountApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/**
 * Account operations always use the live gateway API, never console-read.
 *
 * `explicit` is for the fleet rollout, which has no session: it names the bot
 * and the workspace token itself. Every other caller leaves it out and gets the
 * signed-in user's own bot.
 */
export async function accountRequest(route = '', body?: Record<string, unknown>, explicit?: BotTarget): Promise<unknown> {
  let target: BotTarget;
  try { target = explicit ?? await botTarget(); }
  catch (error) {
    if (error instanceof BotUnavailableError) throw new AccountApiError(error.status === 409 ? 409 : 503, error.detail);
    throw error;
  }
  let response: Response;
  try {
    response = await fetch(`${target.baseUrl}/internal/console/accounts${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { accept: 'application/json', authorization: `Bearer ${target.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store', signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new AccountApiError(503, 'Could not reach account controls. The gateway may be in overnight standby (until 05:45 Africa/Algiers). Refresh status before retrying an action.');
  }
  let value: unknown;
  try { value = await response.json(); }
  catch { throw new AccountApiError(502, 'The account API returned an invalid response.'); }
  if (!response.ok) {
    // Only the dedicated API's curated errors are displayed; HTML/proxy errors
    // and auth diagnostics are never forwarded to the browser.
    const error = value as { error?: unknown };
    const detail = typeof error?.error === 'string' ? error.error : '';
    const message = response.status === 404 ? 'Account controls are unavailable or the pairing session expired. Update the gateway API or start Link again.' :
      response.status === 401 || response.status === 403 ? "Your bot rejected the console's credentials. Check its CONSOLE_API_TOKEN matches this workspace." :
      detail || 'Account operation could not be confirmed. Refresh status before retrying.';
    throw new AccountApiError([400, 404, 409, 502, 503, 504].includes(response.status) ? response.status : 502, message);
  }
  return value;
}

export function checkAccounts(value: unknown): AccountsPayload {
  const payload = value as AccountsPayload;
  if (!payload || typeof payload.observedAt !== 'string' || !Number.isFinite(Date.parse(payload.observedAt)) || !Array.isArray(payload.accounts) ||
      payload.accounts.some((a) => !a || typeof a.id !== 'string' || typeof a.enabled !== 'boolean' ||
        typeof a.repliesEnabled !== 'boolean' || typeof a.hasError !== 'boolean' ||
        ![null, true, false].includes(a.linked) || ![null, true, false].includes(a.running) || ![null, true, false].includes(a.connected) ||
        !(a.number === null || typeof a.number === 'string') ||
        !(a.configured === undefined || typeof a.configured === 'boolean') ||
        !(a.startBlockedReason === null || typeof a.startBlockedReason === 'string') ||
        !(a.pairingSessionId === null || typeof a.pairingSessionId === 'string'))) {
    throw new AccountApiError(502, 'The gateway returned incomplete account status. Update the gateway API.');
  }
  return payload;
}
export function checkLinkSession(value: unknown): LinkSession {
  const s = value as LinkSession;
  if (!s || typeof s.id !== 'string' || typeof s.accountId !== 'string' ||
      !['waiting', 'connected', 'expired', 'failed'].includes(s.state) ||
      typeof s.expiresAt !== 'string' || !Number.isFinite(Date.parse(s.expiresAt)) ||
      !(s.qrDataUrl === null || typeof s.qrDataUrl === 'string' && s.qrDataUrl.length <= 16384 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s.qrDataUrl))) {
    throw new AccountApiError(502, 'The gateway returned an invalid pairing session.');
  }
  return s;
}
export async function getAccounts() { return checkAccounts(await accountRequest()); }
/** The ids of the WhatsApp accounts that are connected right now on this bot. */
export async function connectedAccounts(target: BotTarget): Promise<string[]> {
  const payload = checkAccounts(await accountRequest('', undefined, target));
  return payload.accounts.filter((account) => account.connected === true).map((account) => account.id);
}
