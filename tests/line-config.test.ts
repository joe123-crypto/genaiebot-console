// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { linkedNumberChange, normalizeNumber, sameNumber } from '@/src/domains/line-edit';

const { syncNumber, setContact } = vi.hoisted(() => ({ syncNumber: vi.fn(), setContact: vi.fn() }));
vi.mock('@/app/lines/actions', () => ({ syncLineNumberAction: syncNumber, setContactLineAction: setContact }));

import { AccountManager } from '@/app/lines/account-manager';

const WRITES = {
  enabled: true, affectsProduction: true, delete: ['groups'],
  fields: { lines: ['number'], settings: ['contact_account'], groups: [], campaigns: [] },
};
const live = (id: string, number: string | null) => ({
  id, number, enabled: true, linked: true, running: true, connected: true, repliesEnabled: false,
  startBlockedReason: null, hasError: false, pairingSessionId: null,
});
const line = (id: string, number: string, isContact = false) => ({
  id, number, isContact, groupCount: 1, advertisingCount: 1, campaignCount: 1, promos: [],
});

let membership: { lines: ReturnType<typeof line>[]; writes?: typeof WRITES };
let accounts: ReturnType<typeof live>[];

async function settle() { await act(async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); }); }
function card(id: string) { return screen.getByRole('article', { name: `Account ${id}` }); }

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  accounts = [live('default', '263785632943'), live('ads', '+263790000000')];
  membership = { lines: [line('default', '+263785632943', true), line('ads', '+263790453292')], writes: WRITES };
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const data = String(input) === '/api/account-membership' ? membership : { observedAt: '2026-11-08T00:00:00Z', accounts };
    return new Response(JSON.stringify(data), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); syncNumber.mockReset(); setContact.mockReset(); });

describe('line numbers', () => {
  it('compare by digits, the way WhatsApp and the bot write them differently', () => {
    expect(normalizeNumber('263 785-632943')).toBe('+263785632943');
    expect(normalizeNumber('')).toBeNull();
    expect(sameNumber('263785632943', '+263785632943')).toBe(true);
    expect(linkedNumberChange('+263785632943', '263785632943')).toBeNull();
    expect(linkedNumberChange('+263790453292', '263790000000')).toBe('+263790000000');
    expect(linkedNumberChange('+263790453292', null)).toBeNull();
  });
});

describe('line configuration controls', () => {
  it('are absent while the console is read-only', async () => {
    render(createElement(AccountManager, { writesEnabled: true, configWrites: false })); await settle();
    expect(screen.queryByRole('button', { name: /contact line/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use the linked number' })).toBeNull();
  });

  it('offer the linked number only where it differs from the configured one', async () => {
    render(createElement(AccountManager, { configWrites: true })); await settle();
    expect(within(card('default')).queryByRole('button', { name: 'Use the linked number' })).toBeNull();
    expect(within(card('ads')).getByText(/WhatsApp reports/).textContent).toMatch(/\+263790453292.*\+263790000000/);
    expect(within(card('ads')).getByRole('button', { name: 'Use the linked number' })).toBeTruthy();
  });

  it('copy the linked number only after a yes, then re-read the lines', async () => {
    syncNumber.mockResolvedValue({ ok: true });
    render(createElement(AccountManager, { configWrites: true })); await settle();
    fireEvent.click(within(card('ads')).getByRole('button', { name: 'Use the linked number' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Use the linked number for ads?' });
    expect(dialog.textContent).toMatch(/send customers to \+263790000000 instead of \+263790453292/);
    expect(syncNumber).not.toHaveBeenCalled();
    membership = { ...membership, lines: [membership.lines[0], line('ads', '+263790000000')] };
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Use the linked number' })); });
    await settle();
    expect(syncNumber).toHaveBeenCalledWith('ads');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(within(card('ads')).queryByRole('button', { name: 'Use the linked number' })).toBeNull();
  });

  it('choose the contact line, and can stop using one', async () => {
    setContact.mockResolvedValue({ ok: true });
    render(createElement(AccountManager, { configWrites: true })); await settle();
    fireEvent.click(within(card('ads')).getByRole('button', { name: 'Make this the contact line' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Make ads the contact line?' });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Make contact line' })); });
    expect(setContact).toHaveBeenCalledWith('ads');
    fireEvent.click(within(card('default')).getByRole('button', { name: 'Stop using as contact line' }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Stop using it' }));
    });
    expect(setContact).toHaveBeenLastCalledWith(null);
  });

  it('keep the question open on the reason when the bot refuses', async () => {
    setContact.mockResolvedValue({ ok: false, detail: 'refused', problems: ['defaults.contact_account must name an account with a number'] });
    render(createElement(AccountManager, { configWrites: true })); await settle();
    fireEvent.click(within(card('ads')).getByRole('button', { name: 'Make this the contact line' }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Make contact line' }));
    });
    expect(screen.getByRole('alert').textContent).toMatch(/must name an account with a number/);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('are disabled, saying why, when the bot is too old to report what it accepts', async () => {
    membership = { lines: membership.lines };
    render(createElement(AccountManager, { configWrites: true })); await settle();
    const button = within(card('ads')).getByRole('button', { name: 'Make this the contact line' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/predates editing/);
  });
});

/* -------------------------------------------------------------- actions -- */

describe('line actions', () => {
  const updateLine = vi.fn();
  const updateSettings = vi.fn();
  const getOverview = vi.fn();
  const getAccounts = vi.fn();

  async function load(writes = true) {
    vi.resetModules();
    for (const fn of [updateLine, updateSettings, getOverview, getAccounts]) fn.mockReset();
    getOverview.mockResolvedValue({ accounts: [
      { id: 'default', number: '+263785632943', isContact: true },
      { id: 'ads', number: '+263790453292', isContact: false },
    ] });
    getAccounts.mockResolvedValue({ observedAt: '', accounts: [live('ads', '263790000000')] });
    vi.doUnmock('@/app/lines/actions');
    vi.doMock('@/src/config', () => ({ WRITES_ENABLED: writes, OPERATOR_NAME: 'Joseph' }));
    vi.doMock('next/cache', () => ({ revalidatePath: vi.fn() }));
    vi.doMock('@/src/lib/account-client', () => ({
      getAccounts, AccountApiError: class extends Error {},
    }));
    vi.doMock('@/src/lib/bot-client', () => {
      class BotUnavailableError extends Error {
        detail: string;
        constructor(detail: string) { super(detail); this.detail = detail; }
      }
      return {
        updateLine, updateSettings, getOverview, getConfiguration: getOverview, BotUnavailableError,
        WriteRefusedError: class extends BotUnavailableError { problems: string[] = []; },
        WritesDisabledError: class extends Error { detail = 'writes off'; },
      };
    });
    return vi.importActual<typeof import('@/app/lines/actions')>('@/app/lines/actions');
  }

  afterEach(() => {
    for (const name of ['@/src/config', 'next/cache', '@/src/lib/account-client', '@/src/lib/bot-client']) vi.doUnmock(name);
  });

  it('are guarded while writes are off', async () => {
    const { syncLineNumberAction, setContactLineAction } = await load(false);
    expect((await syncLineNumberAction('ads')).ok).toBe(false);
    expect((await setContactLineAction('ads')).ok).toBe(false);
    expect(getOverview).not.toHaveBeenCalled();
  });

  it('copy the number WhatsApp reports, read on the server, as the bot stores it', async () => {
    const { syncLineNumberAction } = await load();
    expect(await syncLineNumberAction('ads')).toEqual({ ok: true });
    expect(updateLine).toHaveBeenCalledWith('ads', { number: '+263790000000' }, { by: 'Joseph' });
  });

  it('refuse a line WhatsApp reports no number for', async () => {
    const { syncLineNumberAction } = await load();
    getAccounts.mockResolvedValue({ observedAt: '', accounts: [live('ads', null)] });
    expect((await syncLineNumberAction('ads')).ok).toBe(false);
    expect(updateLine).not.toHaveBeenCalled();
  });

  it('set and clear the contact line, refusing an unknown one', async () => {
    const { setContactLineAction } = await load();
    expect(await setContactLineAction('ads')).toEqual({ ok: true });
    expect(updateSettings).toHaveBeenCalledWith({ contact_account: 'ads' }, { by: 'Joseph' });
    expect(await setContactLineAction(null)).toEqual({ ok: true });
    expect(updateSettings).toHaveBeenLastCalledWith({ contact_account: null }, { by: 'Joseph' });
    expect((await setContactLineAction('sales')).ok).toBe(false);
    expect((await setContactLineAction('../x')).ok).toBe(false);
    // Already the contact line: nothing to write.
    updateSettings.mockClear();
    expect(await setContactLineAction('default')).toEqual({ ok: true });
    expect(updateSettings).not.toHaveBeenCalled();
  });
});
