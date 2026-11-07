import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/accounts/[[...path]]/route';

const mockRequest = vi.hoisted(() => vi.fn());
const flags = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/src/config', () => ({ get ACCOUNT_WRITES_ENABLED() { return flags.enabled; }, BOT_API_BASE_URL: '', BOT_API_TOKEN: '' }));
vi.mock('@/src/lib/account-client', async (original) => ({ ...await original<typeof import('@/src/lib/account-client')>(), accountRequest: mockRequest }));
const context = (path: string[] = []) => ({ params: Promise.resolve({ path }) });
const payload = { observedAt: '2026-11-06T00:00:00Z', accounts: [{ id: 'ads', number: null, enabled: false, linked: true, running: false, connected: false,
  repliesEnabled: false, startBlockedReason: null, hasError: false, pairingSessionId: null }] };
const post = (path: string[], body = '{}', origin = 'http://localhost:3000') => POST(new Request(`http://localhost:3000/api/accounts/${path.join('/')}`, {
  method: 'POST', headers: { origin, 'content-type': 'application/json' }, body,
}), context(path));
afterEach(() => { vi.clearAllMocks(); flags.enabled = true; });

describe('account HTTP boundary', () => {
  it('refuses direct account mutations when console writes are off', async () => {
    flags.enabled = false;
    expect((await post(['ads', 'unlink'])).status).toBe(403);
    expect(mockRequest).not.toHaveBeenCalled();
  });
  it('rejects cross-origin mutations before contacting the gateway', async () => {
    expect((await post(['ads', 'unlink'], '{}', 'https://another-site.example')).status).toBe(403);
    expect(mockRequest).not.toHaveBeenCalled();
  });
  it('uses the browser-facing host when Next supplies an internal bind URL', async () => {
    mockRequest.mockResolvedValue(payload);
    const request = new Request('http://localhost:3107/api/accounts/ads/pause', { method: 'POST', headers: { origin: 'http://127.0.0.1:3107', host: '127.0.0.1:3107', 'content-type': 'application/json' }, body: '{}' });
    expect((await POST(request, context(['ads', 'pause']))).status).toBe(200);
  });
  it('allows only known actions and valid account IDs', async () => {
    for (const path of [['ads', 'remove'], ['constructor', 'pause'], ['ads', 'pause', 'extra']]) expect((await post(path)).status).toBe(404);
    expect(mockRequest).not.toHaveBeenCalled();
  });
  it('refuses malformed, extra-field and oversized bodies', async () => {
    expect((await post(['ads', 'pause'], '{bad')).status).toBe(400);
    expect((await post(['ads', 'pause'], '{"force":true}')).status).toBe(400);
    expect((await post([], '{"id":"../default"}')).status).toBe(400);
    expect((await post([], ' '.repeat(2049))).status).toBe(413);
    expect(mockRequest).not.toHaveBeenCalled();
  });
  it('proxies pause without exposing authentication and marks the response uncacheable', async () => {
    mockRequest.mockResolvedValue(payload);
    const response = await post(['ads', 'pause']);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(payload);
    expect(mockRequest).toHaveBeenCalledWith('/ads/pause', {});
  });
  it('rejects incomplete status instead of interpreting missing flags as paused', async () => {
    mockRequest.mockResolvedValue({ accounts: [{ id: 'ads' }] });
    expect((await GET(new Request('http://localhost:3000/api/accounts'), context())).status).toBe(502);
  });
  it('refuses arbitrary URLs and invalid QR content', async () => {
    mockRequest.mockResolvedValue({ id: 'x', accountId: 'ads', state: 'waiting', expiresAt: payload.observedAt, qrDataUrl: 'https://attacker.example/qr' });
    expect((await post(['ads', 'link'])).status).toBe(502);
  });
});
