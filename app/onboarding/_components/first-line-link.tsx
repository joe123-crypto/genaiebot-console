'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { usePolling } from '@/app/_components/use-polling';
import { createLineAction } from '@/app/lines/actions';
import { AccountRequestError, message, request } from '@/app/lines/account-request';
import { FIRST_LINE_ID } from '@/src/domains/line-edit';
import type { AccountsPayload, LinkSession, WhatsAppAccount } from '@/src/lib/account-types';
import type { WriteCapabilities } from '@/src/lib/types';
import { canCreateLine } from '@/src/lib/write-capabilities';

/**
 * The wizard's WhatsApp step: link the workspace's first line, and nothing
 * else. Every other line control -- more lines, relinking, pausing, the
 * contact line -- stays on the Lines page, which this uses the same API as.
 *
 * The QR code is asked for as soon as the step opens, so the first thing on
 * screen is the code to scan rather than a button that fetches it. Only once:
 * a code that expires or fails waits for a click before another is made, so an
 * unattended tab does not keep opening pairing sessions.
 *
 * Once the scan connects, the line gets its configuration document straight
 * away, as the Lines page does, so the campaign step after it has a line that
 * groups can be assigned to. Then the step says WhatsApp is connected and goes
 * on to the campaign step by itself. Only a line the bot could not take keeps
 * a Continue button, so its reason stays on screen until it has been read.
 */

type Config = { state: 'idle' | 'saving' | 'done' } | { state: 'failed'; detail: string };
const CONFIG_ATTEMPTS = 3;
const CONFIG_RETRY_MS = 3000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Long enough to see that it worked before the next step replaces it. */
const CONTINUE_AFTER_MS = 1500;

export function FirstLineLink({ writesEnabled, configWrites, nextHref }: {
  /** The gateway's account controls (`ACCOUNT_WRITES_ENABLED`). */
  writesEnabled: boolean;
  /** The bot's config writer (`WRITES_ENABLED`), for the line's document. */
  configWrites: boolean;
  nextHref: string;
}) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<WhatsAppAccount[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [session, setSession] = useState<LinkSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<Config>({ state: 'idle' });
  /** The one QR code fetched without a click has been asked for. */
  const [autoTried, setAutoTried] = useState(false);
  const starting = useRef(false);
  const configuring = useRef(false);

  const refresh = useCallback(async () => {
    try { setAccounts((await request<AccountsPayload>('/api/accounts')).accounts); setReadError(null); }
    catch (cause) { setReadError(message(cause)); }
  }, []);

  /** The line's configuration document. Retried briefly: WhatsApp can take a
   *  moment after the scan to report the number it is created from. */
  const configure = useCallback(async (id: string) => {
    if (configuring.current) return;
    configuring.current = true;
    setConfig({ state: 'saving' });
    try {
      const { writes } = await request<{ writes?: WriteCapabilities }>('/api/account-membership');
      const gate = canCreateLine(configWrites, writes);
      // Not an error: the line is linked either way, and the Lines page says
      // what the bot would have to accept before it can be used.
      if (!gate.allowed) { setConfig({ state: 'failed', detail: gate.reason }); return; }
      let detail = '';
      for (let attempt = 1; attempt <= CONFIG_ATTEMPTS; attempt += 1) {
        const outcome = await createLineAction(id);
        if (outcome.ok) { setConfig({ state: 'done' }); return; }
        detail = outcome.detail;
        if (attempt < CONFIG_ATTEMPTS) await wait(CONFIG_RETRY_MS);
      }
      setConfig({ state: 'failed', detail });
    } catch (cause) {
      setConfig({ state: 'failed', detail: message(cause) });
    } finally { configuring.current = false; }
  }, [configWrites]);

  // Keyed on the id, not the session: each poll replaces the session object,
  // and polling must not restart itself every time it does.
  const sessionId = session?.id;
  const pollSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const next = await request<LinkSession>(`/api/accounts/link-sessions/${sessionId}`);
      setSession((current) => current?.id === next.id ? next : current);
      if (next.state !== 'waiting') await refresh();
      if (next.state === 'connected') void configure(next.accountId);
    } catch (cause) {
      // Status and QR reads share one gateway bridge; a busy read just waits.
      if (cause instanceof AccountRequestError && cause.status === 409) return;
      setError(message(cause));
    }
  }, [sessionId, refresh, configure]);

  const waiting = session?.state === 'waiting';
  usePolling(refresh, 5000, !waiting && !busy);
  usePolling(pollSession, 2000, Boolean(waiting && !error));

  const first = accounts?.find((account) => account.id === FIRST_LINE_ID);
  const connected = accounts?.find((account) => account.connected === true) ??
    (session?.state === 'connected' ? first : undefined);

  async function link() {
    if (starting.current || !writesEnabled) return;
    starting.current = true;
    setBusy(true); setError(null);
    try {
      // The gateway reports an invented `default` until a line is made, so
      // that one is created; a real one that lost its login is linked again.
      const create = !first || first.configured === false;
      setSession(await request<LinkSession>(create ? '/api/accounts' : `/api/accounts/${FIRST_LINE_ID}/link`,
        create ? { id: FIRST_LINE_ID } : {}));
    } catch (cause) { setError(message(cause)); }
    finally { starting.current = false; setBusy(false); }
  }

  const blocked = first?.startBlockedReason ?? null;
  const connecting = first?.configured !== false && first?.linked === true;
  /** Nothing stands between opening the step and its QR code. */
  const canAutoStart = writesEnabled && !blocked && !connecting;
  const autoStart = !autoTried && Boolean(accounts) && !connected && !session && canAutoStart;
  useEffect(() => {
    if (!autoStart) return;
    setAutoTried(true);
    void link();
  });
  /** Still on the way to the first code: the read, or the request for it. */
  const preparing = !session && !error && !readError && (accounts === null ? writesEnabled : busy || autoStart);
  const pairing = preparing || session?.state === 'waiting';

  // A line scanned here waits for its configuration; one that was already
  // connected when the step opened has nothing to wait for.
  const proceed = Boolean(connected) && (config.state === 'done' || (config.state === 'idle' && !session));
  useEffect(() => {
    if (!proceed) return;
    const timer = setTimeout(() => router.replace(nextHref), CONTINUE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [proceed, router, nextHref]);

  if (connected) {
    return (
      <section className="card card-pad">
        <h2 className="card-title"><CheckCircle2 size={16} aria-hidden /> WhatsApp is connected</h2>
        <p className="card-note">
          {connected.number ? <>Your bot posts from <strong>{connected.number}</strong>. </> : null}
          You can add more numbers later on the WhatsApp lines page.
        </p>
        {config.state === 'saving' ? <p className="card-note" role="status">Adding the line to your bot&apos;s configuration…</p> : null}
        {proceed ? (
          <p className="card-note" role="status">
            <Loader2 size={14} aria-hidden className="setup-spinner" /> Taking you to the next step…{' '}
            <Link prefetch={false} className="link" href={nextHref}>Go now</Link>
          </p>
        ) : null}
        {config.state === 'failed' ? (
          <p className="card-note" role="alert">
            The line is linked, but it could not be added to your bot&apos;s configuration yet: {config.detail}{' '}
            <button type="button" className="link" onClick={() => void configure(connected.id)}>Try again</button>
          </p>
        ) : null}
        {config.state === 'failed' ? (
          <div className="setup-actions">
            <Link prefetch={false} className="btn btn-primary" href={nextHref}>Continue</Link>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <>
      {error || readError ? <div className="banner" role="alert"><AlertTriangle size={17} aria-hidden /><span>{error ?? readError}</span></div> : null}
      <section className="card card-pad">
        {pairing ? (
          <div className="account-pairing" role="status">
            <h2 className="card-title">Scan this code with WhatsApp</h2>
            <p className="card-note">On your phone, open WhatsApp → Linked devices → Link a device, then scan this code.</p>
            {/* Gateway-provided PNG data only; never persist or optimize pairing QR codes. */}
            {session?.qrDataUrl
              ? <img src={session.qrDataUrl} width={280} height={280} alt="WhatsApp pairing QR code" />
              : <div className="account-pairing-placeholder"><Loader2 size={20} aria-hidden className="setup-spinner" />Preparing your QR code…</div>}
            <p className="card-note">{session?.qrDataUrl ? 'Waiting for your scan.' : '\u00a0'}</p>
          </div>
        ) : (
          <>
            <h2 className="card-title">Link your WhatsApp number</h2>
            <p className="card-note">
              Your bot posts campaigns from a WhatsApp number of yours. You link it by scanning a QR code with
              the phone that holds the number, the same way WhatsApp links any other device.
            </p>
            {session?.state === 'expired' ? <p className="card-note" role="status">That code expired before it was scanned.</p> : null}
            {session?.state === 'failed' ? <p className="card-note" role="status">Linking did not finish. Try a new code.</p> : null}
            {!writesEnabled ? <p className="card-note">This console cannot link WhatsApp numbers. Skip setup for now.</p> : null}
            {blocked ? <p className="card-note">{blocked}</p> : null}
            {connecting && !session ? <p className="card-note" role="status">Your number is linked and connecting. If it has not connected in a minute or two, skip setup and relink it from the WhatsApp lines page.</p> : null}
            <div className="setup-actions">
              <button type="button" className="btn btn-primary" onClick={() => void link()}
                disabled={!writesEnabled || busy || !accounts || Boolean(blocked) || (connecting && !session)}>
                {busy ? 'Preparing QR code…' : session ? 'Generate new QR code' : 'Show QR code'}
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
