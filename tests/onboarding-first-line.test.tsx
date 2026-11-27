// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WhatsAppAccount } from '@/src/lib/account-types';

const { createLine } = vi.hoisted(() => ({ createLine: vi.fn() }));
vi.mock('@/app/lines/actions', () => ({ createLineAction: createLine }));
const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

import { FirstLineLink } from '@/app/onboarding/_components/first-line-link';

/** The wizard's WhatsApp step, against the same account API as the Lines page. */

const WRITES = {
  enabled: true, affectsProduction: true, delete: ['groups'],
  fields: { lines: ['number'], settings: ['contact_account'], groups: [], campaigns: [] },
  lineCreation: { create: true },
};
const invented = (overrides: Partial<WhatsAppAccount> = {}): WhatsAppAccount => ({
  id: 'default', number: null, enabled: true, linked: false, running: false, connected: false,
  repliesEnabled: true, configured: false, startBlockedReason: null, hasError: false,
  pairingSessionId: null, ...overrides,
});
const SESSION = '12345678-1234-1234-1234-123456789abc';
let accounts: WhatsAppAccount[];
let posts: Array<{ url: string; body: string }>;
let scanned: boolean;
let expired: boolean;

async function settle() { await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); }); }
async function advance(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); }
const step = (props: Record<string, unknown> = {}) =>
  render(createElement(FirstLineLink, { writesEnabled: true, configWrites: true, nextHref: '/onboarding/campaign', ...props }));

beforeEach(() => {
  vi.useFakeTimers();
  accounts = [invented()]; posts = []; scanned = false; expired = false;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    if (init.method === 'POST') {
      posts.push({ url, body: String(init.body ?? '') });
      accounts = [{ ...invented(), configured: true, pairingSessionId: SESSION }];
      return new Response(JSON.stringify({ id: SESSION, accountId: 'default', state: 'waiting', qrDataUrl: 'data:image/png;base64,YQ==', expiresAt: '2026-11-26T00:02:00Z' }), { status: 200 });
    }
    if (url.includes('/link-sessions/')) {
      if (scanned) accounts = accounts.map((a) => ({ ...a, linked: true, connected: true, number: '+263785632943', pairingSessionId: null }));
      const state = scanned ? 'connected' : expired ? 'expired' : 'waiting';
      return new Response(JSON.stringify({ id: SESSION, accountId: 'default', state, qrDataUrl: state === 'waiting' ? 'data:image/png;base64,YQ==' : null, expiresAt: '2026-11-26T00:02:00Z' }), { status: 200 });
    }
    const data = url === '/api/account-membership' ? { lines: [], writes: WRITES } : { observedAt: '2026-11-26T00:00:00Z', accounts };
    return new Response(JSON.stringify(data), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); createLine.mockReset(); replace.mockReset(); });

describe('the onboarding WhatsApp step', () => {
  it('makes the first line and shows its QR code without a click, then configures it once scanned', async () => {
    createLine.mockResolvedValue({ ok: true });
    step(); await settle();
    expect(posts).toEqual([{ url: '/api/accounts', body: '{"id":"default"}' }]);
    expect(screen.getByAltText('WhatsApp pairing QR code')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /QR code/ })).toBeNull();
    scanned = true;
    await advance(2000); await settle();
    expect(createLine.mock.calls).toEqual([['default']]);
    expect(screen.getByText(/WhatsApp is connected/)).toBeTruthy();
    expect(screen.getByText('+263785632943')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Continue' })).toBeNull();
    expect(screen.getByText(/Taking you to the next step/)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    await advance(1500);
    expect(replace).toHaveBeenCalledWith('/onboarding/campaign');
  });

  it('waits for the line to be configured before moving on', async () => {
    let finish: (value: { ok: true }) => void = () => {};
    createLine.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    step(); await settle();
    scanned = true;
    await advance(2000); await settle();
    expect(screen.getByText(/Adding the line to your bot's configuration/)).toBeTruthy();
    await advance(5000);
    expect(replace).not.toHaveBeenCalled();
    finish({ ok: true }); await settle();
    await advance(1500);
    expect(replace).toHaveBeenCalledWith('/onboarding/campaign');
  });

  it('relinks a real first line that lost its login instead of making another', async () => {
    accounts = [invented({ configured: true })];
    step(); await settle();
    expect(posts).toEqual([{ url: '/api/accounts/default/link', body: '{}' }]);
  });

  it('moves straight on when a line is already connected', async () => {
    accounts = [invented({ configured: true, linked: true, connected: true, running: true, number: '+263700000000' })];
    step(); await settle();
    expect(screen.getByText(/WhatsApp is connected/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show QR code' })).toBeNull();
    expect(posts).toEqual([]);
    await advance(1500);
    expect(replace).toHaveBeenCalledWith('/onboarding/campaign');
  });

  it('holds the QR code\'s place while it is fetched, so nothing jumps when it arrives', async () => {
    step();
    expect(screen.getByText('Preparing your QR code…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show QR code' })).toBeNull();
    await settle();
    expect(screen.queryByText('Preparing your QR code…')).toBeNull();
    expect(screen.getByAltText('WhatsApp pairing QR code')).toBeTruthy();
  });

  it('asks for a new code by click once one expires, rather than making them unattended', async () => {
    step(); await settle();
    expired = true;
    await advance(2000); await settle();
    expect(screen.getByText(/That code expired/)).toBeTruthy();
    await advance(10000); await settle();
    expect(posts).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Generate new QR code' })); await settle();
    expect(posts).toHaveLength(2);
  });

  it('offers nothing to press where this console cannot link numbers', async () => {
    step({ writesEnabled: false }); await settle();
    expect((screen.getByRole('button', { name: 'Show QR code' }) as HTMLButtonElement).disabled).toBe(true);
    expect(posts).toEqual([]);
    expect(screen.getByText(/cannot link WhatsApp numbers/)).toBeTruthy();
  });

  it('keeps the line and says why when the bot cannot configure it', async () => {
    createLine.mockResolvedValue({ ok: false, detail: 'WhatsApp reports no number for this line yet.' });
    step(); await settle();
    scanned = true;
    await advance(2000); await settle();
    await advance(3000); await settle();
    await advance(3000); await settle();
    expect(createLine).toHaveBeenCalledTimes(3);
    expect(screen.getByText(/could not be added to your bot's configuration yet/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Continue' })).toBeTruthy();
    await advance(5000);
    expect(replace).not.toHaveBeenCalled();
  });
});
