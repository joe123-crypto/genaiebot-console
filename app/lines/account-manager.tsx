'use client';

import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { Link2, Pause, Play, Plus, RefreshCw, Unplug, X } from 'lucide-react';
import { PageHead } from '@/app/_components/ui';
import { ACCOUNT_ID, type AccountsPayload, type LinkSession, type WhatsAppAccount } from '@/src/lib/account-types';
import type { LineSummary } from '@/src/domains/console';
import { campaignTitle } from '@/src/lib/format';
import { ConfirmDialog } from '@/app/_components/confirm-dialog';
import { setContactLineAction, syncLineNumberAction } from '@/app/lines/actions';
import { linkedNumberChange } from '@/src/domains/line-edit';
import { canWrite } from '@/src/lib/write-capabilities';
import type { WriteCapabilities } from '@/src/lib/types';

/** A change to the line's configuration, waiting for the operator's yes. */
type LineChange =
  | { kind: 'number'; id: string; from: string; to: string }
  | { kind: 'contact'; id: string; number: string }
  | { kind: 'no-contact'; id: string };

class AccountRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function request<T>(url: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(65_000),
    ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new AccountRequestError(response.status, value.error || 'Account operation failed. Refresh status before retrying.');
  return value as T;
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Account controls are unavailable.';

/** Poll after each completed read; hidden/offline tabs do no background work. */
function usePolling(read: () => Promise<void>, interval: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = document.visibilityState === 'visible' && navigator.onLine;
    async function tick() {
      if (stopped || running || !active) return;
      running = true;
      await read();
      running = false;
      if (!stopped && active) timer = setTimeout(tick, interval);
    }
    function availability() {
      const previous = active;
      active = document.visibilityState === 'visible' && navigator.onLine;
      if (!active) clearTimeout(timer);
      else if (!previous) void tick();
    }
    void tick();
    document.addEventListener('visibilitychange', availability);
    window.addEventListener('online', availability);
    window.addEventListener('offline', availability);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', availability);
      window.removeEventListener('online', availability);
      window.removeEventListener('offline', availability);
    };
  }, [read, interval, enabled]);
}

function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  return (
    <dialog ref={dialog} className="account-dialog" aria-labelledby="account-dialog-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="account-dialog-head">
        <h2 id="account-dialog-title">{title}</h2>
        <button type="button" className="account-icon-button" aria-label="Close dialog" onClick={close}><X size={20} /></button>
      </div>
      {children}
    </dialog>
  );
}

function connection(account: WhatsAppAccount, unavailable: boolean) {
  if (unavailable) return { label: 'Status unavailable', tone: '' };
  if (account.linked === false) return { label: 'Unlinked', tone: 'pill-warning' };
  if (!account.enabled && account.running === false) return { label: 'Paused', tone: 'pill-warning' };
  if (!account.enabled) return { label: 'Pausing…', tone: 'pill-warning' };
  if (account.connected === null) return { label: 'Status unavailable', tone: '' };
  if (account.connected) return { label: 'Connected', tone: 'pill-success' };
  return { label: account.running ? 'Connecting' : 'Disconnected', tone: 'pill-warning' };
}

export function AccountManager({ writesEnabled = false, configWrites = false }: {
  /** Link, Unlink, Pause and Start: the gateway's account controls. */
  writesEnabled?: boolean;
  /** The line's configuration -- its number and the contact line -- which goes
   *  through the bot's config writer, gated separately on what it accepts. */
  configWrites?: boolean;
}) {
  const [data, setData] = useState<AccountsPayload | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [membership, setMembership] = useState<LineSummary[] | null>(null);
  const [membershipError, setMembershipError] = useState(false);
  const [configCapabilities, setConfigCapabilities] = useState<WriteCapabilities | undefined>(undefined);
  const [lineChange, setLineChange] = useState<LineChange | null>(null);
  const [lineError, setLineError] = useState<{ detail: string; problems?: string[] } | null>(null);
  const [linePending, startLineChange] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const actionRunning = useRef(false);
  const reading = useRef<Promise<void> | null>(null);
  const [available, setAvailable] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState('');
  const [unlinking, setUnlinking] = useState<WhatsAppAccount | null>(null);
  const [session, setSession] = useState<LinkSession | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const sessionId = session?.id;
  const sessionWaiting = session?.state === 'waiting';

  const refresh = useCallback(() => {
    if (reading.current) return reading.current;
    const work = (async () => {
      try { setData(await request<AccountsPayload>('/api/accounts')); setReadError(null); }
      catch (error) { setReadError(message(error)); }
    })().finally(() => { reading.current = null; });
    reading.current = work;
    return work;
  }, []);
  const refreshMembership = useCallback(async () => {
    try {
      const result = await request<{ lines: LineSummary[]; writes?: WriteCapabilities }>('/api/account-membership');
      setMembership(result.lines); setConfigCapabilities(result.writes); setMembershipError(false);
    }
    catch { setMembershipError(true); }
  }, []);
  const pollSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const next = await request<LinkSession>(`/api/accounts/link-sessions/${sessionId}`);
      setSession((current) => current?.id === sessionId ? next : current);
      setPairingError(null);
      if (next.state !== 'waiting') await refresh();
    } catch (error) {
      // Status and QR polling share a serialized gateway bridge. A busy read
      // was not executed; keep the existing QR and retry the status read.
      if (error instanceof AccountRequestError && error.status === 409) return;
      setPairingError(message(error));
      // A timed-out poll may have activated the account; reconcile live state.
      await refresh();
    }
  }, [sessionId, refresh]);
  usePolling(refresh, 5000);
  usePolling(refreshMembership, 60_000);
  usePolling(pollSession, 2000, Boolean(sessionWaiting && !pairingError));
  useEffect(() => {
    function update() { setAvailable(navigator.onLine && document.visibilityState === 'visible'); }
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  async function act(id: string, action: 'link' | 'unlink' | 'pause' | 'start', create = false) {
    if (!writesEnabled || actionRunning.current) return;
    actionRunning.current = true;
    setBusy(id); setActionError(null); setNotice(null);
    try {
      if (action === 'link') {
        const result = await request<LinkSession>(create ? '/api/accounts' : `/api/accounts/${id}/link`, create ? { id } : {});
        setSession(result); setPairingError(null); setAdding(false); setNewId('');
      } else {
        setData(await request<AccountsPayload>(`/api/accounts/${id}/${action}`, {}));
        setUnlinking(null);
        setNotice(`${id}: ${action === 'unlink' ? 'WhatsApp login cleared. Configuration and assignments retained.' : action === 'pause' ? 'Paused. Saved login retained.' : 'Started.'}`);
      }
    } catch (error) { setActionError(message(error)); }
    finally {
      // A read begun before the action must not overwrite its outcome afterward.
      await reading.current;
      await refresh();
      actionRunning.current = false; setBusy(null);
    }
  }
  function add(event: FormEvent) {
    event.preventDefault();
    if (!ACCOUNT_ID.test(newId)) { setActionError('Use 1–64 lowercase letters, digits, underscores or hyphens.'); return; }
    void act(newId, 'link', true);
  }
  function closeLineChange() { setLineChange(null); setLineError(null); }
  function applyLineChange() {
    if (!lineChange) return;
    const change = lineChange;
    startLineChange(async () => {
      const outcome = change.kind === 'number' ? await syncLineNumberAction(change.id)
        : await setContactLineAction(change.kind === 'contact' ? change.id : null);
      if (!outcome.ok) { setLineError({ detail: outcome.detail, problems: outcome.problems }); return; }
      closeLineChange();
      setNotice(change.kind === 'number' ? `${change.id}: adverts now give ${change.to}, from each campaign's next run.`
        : change.kind === 'contact' ? `${change.id} is now the contact line, from each campaign's next run.`
          : 'No contact line: each advert gives the number of the line that posts it, from its next run.');
      await refreshMembership();
    });
  }
  const numberGate = canWrite(configWrites, configCapabilities, 'lines', 'number');
  const contactGate = canWrite(configWrites, configCapabilities, 'settings', 'contact_account');
  const lineChangeGate = lineChange?.kind === 'number' ? numberGate : contactGate;
  const unavailable = Boolean(readError || !available);
  const disabled = !writesEnabled || unavailable || Boolean(busy) || !data;
  const configured = new Map(membership?.map((line) => [line.id, line]));
  // Retain configured lines when unavailable, but never imply live state.
  const ids = [...new Set([...(data?.accounts.map((a) => a.id) ?? []), ...(membership?.map((a) => a.id) ?? [])])];

  return (
    <>
      <PageHead title="WhatsApp lines" subtitle="Connect WhatsApp accounts and control when each line runs."
        actions={<button className="account-button account-button-primary" disabled={disabled} onClick={() => { setAdding(true); setActionError(null); }}><Plus size={16} /> Add account</button>} />
      <div className="account-toolbar">
        <span role="status">{!available ? 'Updates paused while hidden or offline.' : readError ? 'Live status unavailable.' : data ? 'Live status · checks every 5 seconds' : 'Loading live status…'}
          {data ? <span className="account-observed">Last observed: <time dateTime={data.observedAt}>{new Date(data.observedAt).toLocaleTimeString()}</time></span> : null}
        </span>
        <button className="account-button" disabled={!available || Boolean(busy)} onClick={() => { void refresh(); void refreshMembership(); }}><RefreshCw size={15} /> Refresh</button>
      </div>
      {!writesEnabled ? <div className="banner">Account actions are read-only. Enable console writes to use Link, Unlink, Pause, and Start.</div> : null}
      {readError ? <div className="banner" role="alert">{readError}</div> : null}
      {actionError ? <div className="banner" role="alert">{actionError}</div> : null}
      {notice ? <p className="account-notice" role="status">{notice}</p> : null}
      {membershipError ? <p className="card-note">Configured group and campaign counts are unavailable. Account controls remain independent.</p> : null}
      {!data && !readError ? <div className="card card-pad" role="status">Checking the gateway…</div> : null}
      <div className="grid grid-two">
        {ids.map((id) => {
          const account = data?.accounts.find((a) => a.id === id);
          const line = configured.get(id);
          const state = account ? connection(account, unavailable) : { label: 'Status unavailable', tone: '' };
          const blocked = disabled || !account;
          return (
            <article className="card" key={id} aria-label={`Account ${id}`}>
              <div className="card-head">
                <h2 className="card-title">{id}{line?.isContact ? <span className="pill pill-info account-contact">Contact line</span> : null}</h2>
                <span className={`pill ${state.tone}`}>{state.label}</span>
              </div>
              <div className="card-pad account-card-body">
                <div className="account-number">{account?.number ?? line?.number ?? 'Number available after linking'}</div>
                <p className="card-note account-policy">{account ? `Automated replies ${account.repliesEnabled ? 'enabled' : 'disabled'} · ${account.enabled ? 'Account enabled' : 'Account disabled'}` : 'Live account configuration unavailable.'}</p>
                <div className="account-stats">
                  <div><span className="stat-label">Groups</span><strong>{membershipError || !membership ? '—' : line?.groupCount ?? 0}</strong></div>
                  <div><span className="stat-label">Advertising</span><strong>{membershipError || !membership ? '—' : line?.advertisingCount ?? 0}</strong></div>
                  <div><span className="stat-label">Campaigns</span><strong>{membershipError || !membership ? '—' : line?.campaignCount ?? 0}</strong></div>
                </div>
                {line?.promos.length ? <div className="tag-row">{line.promos.map((promo) => <span className={`tag${promo.off ? ' tag-off' : ''}`} key={promo.slug}>{campaignTitle(promo.slug)} · {promo.count}</span>)}</div> : null}
                <p className="card-note">Counts show configured assignments; deliveries depend on connection and account state.</p>
                {account?.startBlockedReason ? <p className="card-note">{account.startBlockedReason}</p> : null}
                {configWrites && line ? (() => {
                  const linked = account ? linkedNumberChange(line.number, account.number) : null;
                  return (
                    <div className="account-config">
                      {linked ? <p className="card-note">Adverts on this line give <strong>{line.number}</strong>, but WhatsApp reports <strong>{linked}</strong>.</p> : null}
                      <div className="account-actions">
                        {linked ? <button className="account-button" disabled={!numberGate.allowed || linePending}
                          title={numberGate.allowed ? undefined : numberGate.reason}
                          onClick={() => setLineChange({ kind: 'number', id, from: line.number, to: linked })}>Use the linked number</button> : null}
                        {line.isContact
                          ? <button className="account-button" disabled={!contactGate.allowed || linePending}
                              title={contactGate.allowed ? undefined : contactGate.reason}
                              onClick={() => setLineChange({ kind: 'no-contact', id })}>Stop using as contact line</button>
                          : <button className="account-button" disabled={!contactGate.allowed || linePending || !line.number}
                              title={!contactGate.allowed ? contactGate.reason : !line.number ? 'This line has no number yet.' : undefined}
                              onClick={() => setLineChange({ kind: 'contact', id, number: line.number })}>Make this the contact line</button>}
                      </div>
                    </div>
                  );
                })() : null}
                {account?.hasError && !unavailable ? <p className="card-note">The gateway reported a connection error. Refresh status; Unlink, then Link, if the saved login is invalid.</p> : null}
                <div className="account-actions" aria-busy={busy === id}>
                  <button className="account-button" disabled={blocked || Boolean(account?.startBlockedReason) || account?.linked === true && !account.pairingSessionId}
                    onClick={() => void act(id, 'link')}><Link2 size={15} />{account?.pairingSessionId ? 'Continue linking' : 'Link'}</button>
                  {account?.enabled ? <button className="account-button" disabled={blocked || Boolean(account.pairingSessionId)} onClick={() => void act(id, 'pause')}><Pause size={15} /> Pause</button> :
                    <button className="account-button" disabled={blocked || account?.linked !== true || Boolean(account?.startBlockedReason) || Boolean(account?.pairingSessionId)} onClick={() => void act(id, 'start')}><Play size={15} /> Start</button>}
                  <button className="account-button account-button-danger" disabled={blocked || account?.linked === false || Boolean(account?.pairingSessionId)} onClick={() => { setUnlinking(account!); setActionError(null); }}><Unplug size={15} /> Unlink</button>
                  {busy === id ? <span className="card-note" role="status">Working…</span> : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {data && ids.length === 0 ? <p className="empty">No accounts configured. Add an account to connect WhatsApp.</p> : null}
      {lineChange ? (
        <ConfirmDialog
          title={lineChange.kind === 'number' ? `Use the linked number for ${lineChange.id}?`
            : lineChange.kind === 'contact' ? `Make ${lineChange.id} the contact line?` : `Stop using ${lineChange.id} as the contact line?`}
          confirmLabel={lineChange.kind === 'number' ? 'Use the linked number' : lineChange.kind === 'contact' ? 'Make contact line' : 'Stop using it'}
          warning={lineChangeGate.allowed ? lineChangeGate.warning : undefined}
          pending={linePending}
          error={lineError}
          onConfirm={applyLineChange}
          onClose={closeLineChange}
        >
          {lineChange.kind === 'number'
            ? <p>Adverts on this line will send customers to <strong>{lineChange.to}</strong> instead of {lineChange.from}, from each campaign&apos;s next run.</p>
            : lineChange.kind === 'contact'
              ? <p>Every advert will give <strong>{lineChange.number}</strong> as the number to contact, whichever line posts it, from each campaign&apos;s next run.</p>
              : <p>Each advert will give the number of the line that posts it, from each campaign&apos;s next run.</p>}
        </ConfirmDialog>
      ) : null}
      {adding ? <Modal title="Add WhatsApp account" close={() => !busy && setAdding(false)}>
        <form onSubmit={add} className="account-form">
          <label htmlFor="account-id">Account ID</label>
          <input id="account-id" autoFocus value={newId} disabled={Boolean(busy)} maxLength={64} required pattern="[a-z0-9][a-z0-9_-]{0,63}" onChange={(event) => setNewId(event.target.value)} placeholder="e.g. sales" />
          <p className="card-note">Use lowercase letters, digits, underscores or hyphens. New accounts have automated replies disabled and no group assignments.</p>
          {actionError ? <p role="alert">{actionError}</p> : null}
          <button className="account-button account-button-primary" disabled={disabled || !newId}>Generate QR code</button>
        </form>
      </Modal> : null}
      {unlinking ? <Modal title={`Unlink ${unlinking.id}?`} close={() => !busy && setUnlinking(null)}>
        <p>This stops sends and replies and clears the saved WhatsApp login. Configuration, group assignments and contact references stay in place. Connecting again requires a QR scan.</p>
        <p className="card-note">Messages already submitted to WhatsApp may still be delivered.</p>
        {actionError ? <p role="alert">{actionError}</p> : null}
        <div className="account-actions"><button className="account-button" disabled={Boolean(busy)} onClick={() => setUnlinking(null)}>Cancel</button><button className="account-button account-button-danger" disabled={disabled} onClick={() => void act(unlinking.id, 'unlink')}>Unlink account</button></div>
      </Modal> : null}
      {session ? <Modal title={`Link ${session.accountId}`} close={() => { setSession(null); setPairingError(null); }}>
        <div className="account-pairing" role="status">
          {session.state === 'waiting' && !pairingError ? <>
            <p>On your phone, open WhatsApp → Linked devices → Link a device, then scan this code.</p>
            {/* Gateway-provided PNG data only; never persist or optimize pairing QR codes. */}
            {session.qrDataUrl ? <img src={session.qrDataUrl} width={280} height={280} alt={`WhatsApp pairing QR code for ${session.accountId}`} /> : <p>Waiting for QR code…</p>}
            <p className="card-note">Waiting for your scan. Closing this dialog stops checks; Continue linking reopens the current attempt.</p>
          </> : <>
            <p>{pairingError ?? (session.state === 'connected' ? 'WhatsApp linked and the account is active.' : session.state === 'expired' ? 'This pairing attempt expired. Generate a new QR code to continue.' : 'Pairing failed. Refresh account status before trying again.')}</p>
            {pairingError ? <button className="account-button" onClick={() => setPairingError(null)}>Check pairing status</button> : null}
            {session.state === 'expired' || session.state === 'failed' ? <button className="account-button account-button-primary" disabled={disabled} onClick={() => void act(session.accountId, 'link')}>Generate new QR code</button> : null}
          </>}
        </div>
      </Modal> : null}
    </>
  );
}
