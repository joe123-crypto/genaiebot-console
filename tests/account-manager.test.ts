// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountManager } from '@/app/lines/account-manager';
import type { WhatsAppAccount } from '@/src/lib/account-types';

const account = { id: 'ads', number: '+263123456789', enabled: true, linked: true, running: true, connected: true,
  repliesEnabled: false, startBlockedReason: null, hasError: false, pairingSessionId: null };
let accounts: WhatsAppAccount[];
let calls: Array<{ url: string; method: string }>;
let failRead: boolean;
const sessionId = '12345678-1234-1234-1234-123456789abc';
let scans: boolean;
let pairingBusy: boolean;
let pairingAccount: string;
let failUnlink: boolean;
let failLink: boolean;
let waitForUnlink: Promise<void> | null;
let deferUnlink: boolean;
let configApplying: boolean;
const payload = () => ({ observedAt: '2026-11-06T00:00:00Z', accounts });
const mutations = () => calls.filter((call) => call.method === 'POST').map((call) => call.url);
const confirmRelink = () => fireEvent.click(screen.getByRole('button', { name: 'Replace login and show QR' }));
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
async function advance(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); }

beforeEach(() => {
  vi.useFakeTimers();
  accounts = [{ ...account }]; calls = []; failRead = false; scans = false; pairingBusy = false;
  pairingAccount = 'sales'; failUnlink = false; failLink = false; waitForUnlink = null;
  deferUnlink = false; configApplying = false;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = String(input); const method = init.method ?? 'GET'; calls.push({ url, method });
    let data: unknown = payload(); let status = 200;
    if (url === '/api/account-membership') { status = 503; data = { error: 'membership failed' }; }
    else if (url.includes('/link-sessions/') && pairingBusy) { status = 409; data = { error: 'Another operation is in progress.' }; }
    else if (url.includes('/link-sessions/')) {
      if (scans) accounts = accounts.map((entry) => entry.id === pairingAccount
        ? { ...entry, enabled: true, linked: true, running: true, connected: true, hasError: false, pairingSessionId: null } : entry);
      data = { id: sessionId, accountId: pairingAccount, state: scans ? 'connected' : 'waiting', qrDataUrl: scans ? null : 'data:image/png;base64,YQ==', expiresAt: '2026-11-06T00:02:00Z' };
    }
    else if (method === 'POST') {
      if (url === '/api/accounts') {
        accounts.push({ ...account, id: 'sales' });
        data = { id: sessionId, accountId: 'sales', state: 'waiting', qrDataUrl: 'data:image/png;base64,YQ==', expiresAt: '2026-11-06T00:02:00Z' };
      } else if (url.endsWith('/pause')) { accounts[0] = { ...accounts[0], enabled: false, running: false, connected: false }; data = payload(); }
      else if (url.endsWith('/start')) { accounts[0] = { ...accounts[0], enabled: true, running: true, connected: true }; data = payload(); }
      else if (url.endsWith('/unlink')) {
        await waitForUnlink;
        if (deferUnlink) {
          configApplying = true; status = 409;
          data = { error: 'Account setting is saved; gateway configuration is still being applied. Refresh status before retrying.' };
        } else if (failUnlink) { status = 502; data = { error: 'Logout could not be confirmed' }; }
        else { accounts[0] = { ...accounts[0], enabled: false, linked: false, running: false, connected: false }; data = payload(); }
      } else if (url.endsWith('/link')) {
        if (failLink) { status = 502; data = { error: 'QR generation failed' }; }
        else {
          pairingAccount = url.split('/')[3];
          accounts = accounts.map((entry) => entry.id === pairingAccount ? { ...entry, pairingSessionId: sessionId } : entry);
          data = { id: sessionId, accountId: pairingAccount, state: 'waiting', qrDataUrl: 'data:image/png;base64,YQ==', expiresAt: '2026-11-06T00:02:00Z' };
        }
      }
    } else if (configApplying) { status = 503; data = { error: 'Gateway configuration is still being applied. Refresh account status shortly.' }; }
    else if (failRead) { status = 503; data = { error: 'Gateway unavailable' }; }
    return new Response(JSON.stringify(data), { status });
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('WhatsApp account management', () => {
  it.each([true, null])('replaces a disconnected login (%s) after confirmation and activates after scanning', async (linked) => {
    accounts[0] = { ...account, linked, connected: null, running: null, hasError: true };
    render(createElement(AccountManager, { writesEnabled: true })); await settle();
    expect(screen.getByText('Status unavailable')).toBeTruthy();
    const link = screen.getByRole('button', { name: 'Link' }) as HTMLButtonElement;
    expect(link.disabled).toBe(false);
    fireEvent.click(link);
    const dialog = screen.getByRole('dialog', { name: 'Relink ads?' });
    expect(within(dialog).getByText(/automated reply policies stay in place/)).toBeTruthy();
    expect(mutations()).toEqual([]);
    confirmRelink(); await settle();
    expect(mutations()).toEqual(['/api/accounts/ads/unlink', '/api/accounts/ads/link']);
    expect(screen.queryByRole('dialog', { name: 'Relink ads?' })).toBeNull();
    expect(screen.getByRole('img', { name: /pairing QR code for ads/ })).toBeTruthy();
    scans = true; await advance(2000);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('WhatsApp linked and the account is active.')).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(accounts[0].repliesEnabled).toBe(false);
  });

  it('cancels replacement without mutations and leaves connected accounts protected', async () => {
    render(createElement(AccountManager, { writesEnabled: true })); await settle();
    const link = screen.getByRole('button', { name: 'Link' }) as HTMLButtonElement;
    expect(link.disabled).toBe(true);
    accounts[0] = { ...account, connected: false }; await advance(5000);
    fireEvent.click(link);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mutations()).toEqual([]);
  });

  it('pairs an unlinked account directly without confirmation or logout', async () => {
    accounts[0] = { ...account, linked: false, connected: false };
    render(createElement(AccountManager, { writesEnabled: true })); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Link' })); await settle();
    expect(mutations()).toEqual(['/api/accounts/ads/link']);
    expect(screen.getByRole('img', { name: /pairing QR code for ads/ })).toBeTruthy();
  });

  it('resumes an existing pairing even when the account reports connected', async () => {
    accounts[0] = { ...account, pairingSessionId: sessionId };
    render(createElement(AccountManager, { writesEnabled: true })); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Continue linking' })); await settle();
    expect(mutations()).toEqual(['/api/accounts/ads/link']);
    expect(screen.getByRole('img', { name: /pairing QR code for ads/ })).toBeTruthy();
  });

  it('retains the login if the account reconnects before confirmation', async () => {
    accounts[0] = { ...account, connected: false };
    render(createElement(AccountManager, { writesEnabled: true })); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    accounts[0] = { ...account };
    confirmRelink(); await settle();
    expect(mutations()).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(/already connected. Saved login retained/)).toBeTruthy();
  });

  it.each(['pairing', 'unlinked'])('uses fresh status when the account becomes %s before confirmation', async (state) => {
    accounts[0] = { ...account, connected: false };
    render(createElement(AccountManager, { writesEnabled: true })); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    accounts[0] = { ...accounts[0], linked: state !== 'unlinked', pairingSessionId: state === 'pairing' ? sessionId : null };
    confirmRelink(); await settle();
    expect(mutations()).toEqual(['/api/accounts/ads/link']);
    expect(screen.getByRole('img', { name: /pairing QR code for ads/ })).toBeTruthy();
  });

  it.each(['unavailable', 'blocked', 'removed'])('does not replace the login when fresh status is %s', async (state) => {
    accounts[0] = { ...account, connected: false };
    render(createElement(AccountManager, { writesEnabled: true })); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    if (state === 'unavailable') failRead = true;
    else if (state === 'blocked') accounts[0].startBlockedReason = 'WhatsApp is disabled';
    else accounts = [];
    confirmRelink(); await settle();
    expect(mutations()).toEqual([]);
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toBeTruthy();
  });

  it('stops after an uncertain unlink without retrying mutations', async () => {
    accounts[0] = { ...account, connected: false }; failUnlink = true;
    render(createElement(AccountManager, { writesEnabled: true })); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    confirmRelink(); await settle(); await advance(5000);
    expect(mutations()).toEqual(['/api/accounts/ads/unlink']);
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toContain('Logout could not be confirmed');
  });

  it('shows pending configuration as waiting and continues only after the operator chooses to', async () => {
    accounts[0] = { ...account, connected: null, hasError: true }; deferUnlink = true;
    render(createElement(AccountManager, { writesEnabled: true })); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    confirmRelink(); await settle();
    const dialog = screen.getByRole('dialog', { name: 'Relink ads?' });
    expect(within(dialog).getByRole('status').textContent).toContain('Waiting for the gateway');
    expect((within(dialog).getByRole('button', { name: 'Continue relinking' }) as HTMLButtonElement).disabled).toBe(true);
    const check = within(dialog).getByRole('button', { name: 'Check status' }) as HTMLButtonElement;
    expect(check.disabled).toBe(false);
    fireEvent.click(check); await settle(); await advance(5000);
    expect(mutations()).toEqual(['/api/accounts/ads/unlink']);
    configApplying = false; deferUnlink = false;
    accounts[0] = { ...accounts[0], enabled: false, running: false };
    await advance(5000);
    expect(within(dialog).getByRole('status').textContent).toContain('The gateway is ready');
    expect(mutations()).toEqual(['/api/accounts/ads/unlink']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue relinking' })); await settle();
    expect(mutations()).toEqual(['/api/accounts/ads/unlink', '/api/accounts/ads/unlink', '/api/accounts/ads/link']);
    expect(screen.getByRole('img', { name: /pairing QR code for ads/ })).toBeTruthy();
  });

  it('recovers a failed confirmation status read using Check status inside the dialog', async () => {
    accounts[0] = { ...account, connected: false };
    render(createElement(AccountManager, { writesEnabled: true })); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    failRead = true;
    confirmRelink(); await settle();
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByRole('button', { name: 'Replace login and show QR' }) as HTMLButtonElement).disabled).toBe(true);
    failRead = false;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check status' })); await settle();
    expect((within(dialog).getByRole('button', { name: 'Replace login and show QR' }) as HTMLButtonElement).disabled).toBe(false);
    expect(mutations()).toEqual([]);
    confirmRelink(); await settle();
    expect(screen.getByRole('img', { name: /pairing QR code for ads/ })).toBeTruthy();
  });

  it('keeps cancellation available while a saved configuration is waiting to apply', async () => {
    accounts[0] = { ...account, connected: false }; deferUnlink = true;
    render(createElement(AccountManager, { writesEnabled: true })); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    confirmRelink(); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(10_000);
    expect(mutations()).toEqual(['/api/accounts/ads/unlink']);
  });

  it('waits without mutations when configuration is already applying at confirmation', async () => {
    accounts[0] = { ...account, connected: false };
    render(createElement(AccountManager, { writesEnabled: true })); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    configApplying = true;
    confirmRelink(); await settle();
    expect(within(screen.getByRole('dialog')).getByRole('status').textContent).toContain('Waiting for the gateway');
    expect(mutations()).toEqual([]);
    configApplying = false;
    fireEvent.click(screen.getByRole('button', { name: 'Check status' })); await settle();
    expect((screen.getByRole('button', { name: 'Continue relinking' }) as HTMLButtonElement).disabled).toBe(false);
    expect(mutations()).toEqual([]);
  });

  it('allows direct QR retry if logout succeeded but pairing failed', async () => {
    accounts[0] = { ...account, connected: false }; failLink = true;
    render(createElement(AccountManager, { writesEnabled: true })); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    confirmRelink(); await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Use Link to try again');
    expect(screen.getByText('Unlinked')).toBeTruthy();
    failLink = false;
    fireEvent.click(screen.getByRole('button', { name: 'Link' })); await settle();
    expect(mutations()).toEqual(['/api/accounts/ads/unlink', '/api/accounts/ads/link', '/api/accounts/ads/link']);
    expect(screen.getByRole('img', { name: /pairing QR code for ads/ })).toBeTruthy();
  });

  it('locks replacement against duplicate submissions, closing, and background status reads', async () => {
    let release!: () => void;
    waitForUnlink = new Promise<void>((resolve) => { release = resolve; });
    accounts[0] = { ...account, connected: false };
    render(createElement(AccountManager, { writesEnabled: true })); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    const confirm = screen.getByRole('button', { name: 'Replace login and show QR' });
    fireEvent.click(confirm); fireEvent.click(confirm); await settle();
    expect(mutations()).toEqual(['/api/accounts/ads/unlink']);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.getByRole('dialog', { name: 'Relink ads?' })).toBeTruthy();
    const count = calls.filter((call) => call.url === '/api/accounts').length;
    await advance(5000);
    expect(calls.filter((call) => call.url === '/api/accounts')).toHaveLength(count);
    await act(async () => { release(); }); await settle();
    expect(mutations()).toEqual(['/api/accounts/ads/unlink', '/api/accounts/ads/link']);
    expect(screen.getByRole('img', { name: /pairing QR code for ads/ })).toBeTruthy();
  });

  it.each(['read-only', 'offline', 'blocked', 'read-failed'])('guards disconnected Link when %s', async (state) => {
    accounts[0] = { ...account, connected: false, startBlockedReason: state === 'blocked' ? 'WhatsApp is disabled' : null };
    render(createElement(AccountManager, { writesEnabled: state !== 'read-only' })); await settle();
    if (state === 'read-failed') { failRead = true; await advance(5000); }
    if (state === 'offline') {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      fireEvent(window, new Event('offline')); await settle();
    }
    const link = screen.getByRole('button', { name: 'Link' }) as HTMLButtonElement;
    expect(link.disabled).toBe(true);
    fireEvent.click(link);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mutations()).toEqual([]);
  });

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
