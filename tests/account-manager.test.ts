// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountManager } from '@/app/lines/account-manager';

const account = { id: 'ads', number: '+263123456789', enabled: true, linked: true, running: true, connected: true,
  repliesEnabled: false, startBlockedReason: null, hasError: false, pairingSessionId: null };
let accounts: typeof account[];
let calls: Array<{ url: string; method: string }>;
let failRead: boolean;
const sessionId = '12345678-1234-1234-1234-123456789abc';
let scans: boolean;
let pairingBusy: boolean;
const payload = () => ({ observedAt: '2026-11-06T00:00:00Z', accounts });
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
async function advance(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); }

beforeEach(() => {
  vi.useFakeTimers();
  accounts = [{ ...account }]; calls = []; failRead = false; scans = false; pairingBusy = false;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = String(input); const method = init.method ?? 'GET'; calls.push({ url, method });
    let data: unknown = payload(); let status = 200;
    if (url === '/api/account-membership') { status = 503; data = { error: 'membership failed' }; }
    else if (url.includes('/link-sessions/') && pairingBusy) { status = 409; data = { error: 'Another operation is in progress.' }; }
    else if (url.includes('/link-sessions/')) data = { id: sessionId, accountId: 'sales', state: scans ? 'connected' : 'waiting', qrDataUrl: scans ? null : 'data:image/png;base64,YQ==', expiresAt: '2026-11-06T00:02:00Z' };
    else if (method === 'POST') {
      if (url === '/api/accounts') {
        accounts.push({ ...account, id: 'sales' });
        data = { id: sessionId, accountId: 'sales', state: 'waiting', qrDataUrl: 'data:image/png;base64,YQ==', expiresAt: '2026-11-06T00:02:00Z' };
      } else if (url.endsWith('/pause')) { accounts[0] = { ...accounts[0], enabled: false, running: false, connected: false }; data = payload(); }
      else if (url.endsWith('/start')) { accounts[0] = { ...accounts[0], enabled: true, running: true, connected: true }; data = payload(); }
      else if (url.endsWith('/unlink')) { accounts[0] = { ...accounts[0], enabled: false, linked: false, running: false, connected: false }; data = payload(); }
    } else if (failRead) { status = 503; data = { error: 'Gateway unavailable' }; }
    return new Response(JSON.stringify(data), { status });
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('WhatsApp account management', () => {
  it('shows live status but keeps actions disabled when console writes are off', async () => {
    render(createElement(AccountManager, { writesEnabled: false })); await settle();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText(/Account actions are read-only/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Pause' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Add account' }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
  it('keeps account controls usable when membership reads fail; pause and start need no QR', async () => {
    render(createElement(AccountManager, { writesEnabled: true })); await settle();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText(/counts are unavailable/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' })); await settle();
    expect(screen.getByText('Paused')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start' })); await settle();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual(['/api/accounts/ads/pause', '/api/accounts/ads/start']);
  });
  it('requires explicit confirmation before unlinking', async () => {
    render(createElement(AccountManager, { writesEnabled: true })); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Configuration, group assignments/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unlink account' })); await settle();
    expect(screen.getByText('Unlinked')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });
  it('marks failed live reads unavailable and disables actions instead of displaying stale connection status', async () => {
    render(createElement(AccountManager, { writesEnabled: true })); await settle(); failRead = true;
    await advance(5000);
    expect(screen.queryByText('Connected')).toBeNull();
    expect(screen.getByText('Status unavailable')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Pause' }) as HTMLButtonElement).disabled).toBe(true);
    failRead = false; await advance(5000);
    expect(screen.getByText('Connected')).toBeTruthy();
  });
  it('stops hidden/offline polling and refreshes immediately on return', async () => {
    render(createElement(AccountManager, { writesEnabled: true })); await settle();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    const count = calls.length; await advance(10_000); expect(calls).toHaveLength(count);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange')); await settle(); expect(calls.length).toBeGreaterThan(count);
  });
  it('adds an account, polls its existing QR session and stops checks after the dialog closes', async () => {
    render(createElement(AccountManager, { writesEnabled: true })); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
    fireEvent.change(screen.getByLabelText('Account ID'), { target: { value: 'sales' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate QR code' })); await settle();
    expect(screen.getByRole('img', { name: /pairing QR code for sales/ })).toBeTruthy();
    await advance(2000);
    expect(calls.filter((c) => c.url === '/api/accounts' && c.method === 'POST')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    const count = calls.filter((c) => c.url.includes('/link-sessions/')).length;
    await advance(10_000);
    expect(calls.filter((c) => c.url.includes('/link-sessions/'))).toHaveLength(count);
  });
  it('keeps the QR and retries status when another read temporarily owns the bridge', async () => {
    render(createElement(AccountManager, { writesEnabled: true })); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
    fireEvent.change(screen.getByLabelText('Account ID'), { target: { value: 'sales' } });
    pairingBusy = true;
    fireEvent.click(screen.getByRole('button', { name: 'Generate QR code' })); await settle();
    expect(screen.getByRole('img', { name: /pairing QR code for sales/ })).toBeTruthy();
    await advance(2000);
    expect(screen.getByRole('img', { name: /pairing QR code for sales/ })).toBeTruthy();
    pairingBusy = false; scans = true;
    await advance(2000);
    expect(screen.getByText('WhatsApp linked and the account is active.')).toBeTruthy();
    expect(calls.filter((c) => c.url === '/api/accounts' && c.method === 'POST')).toHaveLength(1);
  });
  it('clears the QR and reports successful activation after a scan', async () => {
    render(createElement(AccountManager, { writesEnabled: true })); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
    fireEvent.change(screen.getByLabelText('Account ID'), { target: { value: 'sales' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate QR code' })); await settle();
    scans = true; await advance(2000);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('WhatsApp linked and the account is active.')).toBeTruthy();
  });
});
