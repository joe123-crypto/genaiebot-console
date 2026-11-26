// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WhatsAppAccount } from '@/src/lib/account-types';

const { createLine } = vi.hoisted(() => ({ createLine: vi.fn() }));
vi.mock('@/app/lines/actions', () => ({
  createLineAction: createLine, syncLineNumberAction: vi.fn(), setContactLineAction: vi.fn(),
}));

import { AccountManager } from '@/app/lines/account-manager';

const WRITES = {
  enabled: true, affectsProduction: true, delete: ['groups'],
  fields: { lines: ['number'], settings: ['contact_account'], groups: [], campaigns: [] },
  lineCreation: { create: true },
};
/** What the gateway reports for a workspace that has made no lines: one
 *  account it invented, with nothing behind it. */
const invented = (overrides: Partial<WhatsAppAccount> = {}): WhatsAppAccount => ({
  id: 'default', number: null, enabled: true, linked: false, running: false, connected: false,
  repliesEnabled: true, configured: false, startBlockedReason: null, hasError: false,
  pairingSessionId: null, ...overrides,
});
const real = (id: string, overrides: Partial<WhatsAppAccount> = {}): WhatsAppAccount => ({
  ...invented(), id, number: '+263785632943', linked: true, running: true, connected: true,
  configured: true, ...overrides,
});
const line = (id: string) => ({ id, number: '+263785632943', isContact: false, groupCount: 0, advertisingCount: 0, campaignCount: 0, promos: [] });

const SESSION = '12345678-1234-1234-1234-123456789abc';
let accounts: WhatsAppAccount[];
let membership: { lines: ReturnType<typeof line>[]; writes?: Record<string, unknown> };
let posts: Array<{ url: string; body: string }>;
let scanned: boolean;

async function settle() { await act(async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); }); }
async function advance(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); }
const manager = (props: Record<string, unknown> = {}) =>
  render(createElement(AccountManager, { writesEnabled: true, configWrites: true, ...props }));

beforeEach(() => {
  vi.useFakeTimers();
  accounts = [invented()];
  membership = { lines: [], writes: WRITES };
  posts = []; scanned = false;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    if (init.method === 'POST') {
      posts.push({ url, body: String(init.body ?? '') });
      const id = JSON.parse(String(init.body || '{}')).id ?? 'default';
      accounts = [...accounts.filter((a) => a.id !== id), { ...invented({ id }), configured: true, pairingSessionId: SESSION }];
      return new Response(JSON.stringify({ id: SESSION, accountId: id, state: 'waiting', qrDataUrl: 'data:image/png;base64,YQ==', expiresAt: '2026-11-26T00:02:00Z' }), { status: 200 });
    }
    if (url.includes('/link-sessions/')) {
      if (scanned) accounts = accounts.map((a) => ({ ...a, linked: true, connected: true, number: '+263785632943', pairingSessionId: null }));
      return new Response(JSON.stringify({ id: SESSION, accountId: 'default', state: scanned ? 'connected' : 'waiting', qrDataUrl: scanned ? null : 'data:image/png;base64,YQ==', expiresAt: '2026-11-26T00:02:00Z' }), { status: 200 });
    }
    const data = url === '/api/account-membership' ? membership : { observedAt: '2026-11-26T00:00:00Z', accounts };
    return new Response(JSON.stringify(data), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); createLine.mockReset(); });

describe('a workspace with no lines', () => {
  it('shows none, and offers to make the first one', async () => {
    manager(); await settle();
    expect(screen.queryAllByRole('article')).toEqual([]);
    expect(screen.getByText(/No WhatsApp lines yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add your first line/ })).toBeTruthy();
  });

  it('names the first line itself instead of asking', async () => {
    manager(); await settle();
    fireEvent.click(screen.getByRole('button', { name: /Add your first line/ })); await settle();
    expect(posts).toEqual([{ url: '/api/accounts', body: '{"id":"default"}' }]);
    expect(screen.queryByLabelText('Line name')).toBeNull();
    expect(screen.getByAltText(/pairing QR code for default/)).toBeTruthy();
  });

  it('adds the line to the configuration once it is scanned', async () => {
    createLine.mockResolvedValue({ ok: true });
    manager(); await settle();
    fireEvent.click(screen.getByRole('button', { name: /Add your first line/ })); await settle();
    scanned = true;
    await advance(2000); await settle();
    expect(createLine.mock.calls).toEqual([['default']]);
  });

  it('says why when the gateway will not start that line, and does not offer it', async () => {
    accounts = [invented({ startBlockedReason: 'REPLIES_DISABLED prevents starting this account.' })];
    manager(); await settle();
    expect(screen.getByText(/REPLIES_DISABLED/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Add your first line/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('still links against a bot that cannot configure a line, and says so', async () => {
    const { lineCreation: _absent, ...older } = WRITES;
    membership = { lines: [], writes: older };
    manager(); await settle();
    expect(screen.getByText(/Deploy the companion bot update/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Add your first line/ })); await settle();
    scanned = true;
    await advance(2000); await settle();
    expect(createLine).not.toHaveBeenCalled();
  });
});

describe('a workspace that already has a line', () => {
  beforeEach(() => { accounts = [real('default')]; membership = { lines: [line('default')], writes: WRITES }; });

  it('asks for a name for the next one', async () => {
    manager(); await settle();
    expect(screen.queryByText(/No WhatsApp lines yet/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.change(screen.getByLabelText('Line name'), { target: { value: 'sales' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate QR code' })); await settle();
    expect(posts).toEqual([{ url: '/api/accounts', body: '{"id":"sales"}' }]);
  });

  it('refuses a name it already has without asking the gateway', async () => {
    manager(); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.change(screen.getByLabelText('Line name'), { target: { value: 'default' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate QR code' })); await settle();
    expect(posts).toEqual([]);
    expect(screen.getAllByText(/already exists/).length).toBeGreaterThan(0);
  });

  it('offers to finish a line that is linked but not configured', async () => {
    membership = { lines: [], writes: WRITES };
    manager(); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Add this line to the configuration' })); await settle();
    createLine.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: 'Add the line' })); await settle();
    expect(createLine.mock.calls).toEqual([['default']]);
  });
});
