"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Circle, Loader2 } from "lucide-react";
import { authFetch } from "@/src/lib/auth-browser";
import { usePolling } from "@/app/_components/use-polling";
import {
  PROVISION_STAGES,
  STAGE_LABEL,
  checkProvisionState,
  stageStatus,
  type ProvisionStage,
  type ProvisionState,
  type StepState,
} from "@/src/domains/bot-provisioning";

/**
 * Creating this workspace's bot, from the screen a workspace without one lands
 * on. There is one bot per workspace and nothing to choose about it, so this
 * asks for nothing: a button, then the stages it is waiting on.
 *
 * Linking WhatsApp is not part of it. That belongs on the Lines page, with the
 * pairing it already does, and this hands over to it once there is a bot to
 * pair against.
 */

const ROUTE = "/api/bot/provision";
const POLL_MS = 2000;

async function request(method: "GET" | "POST"): Promise<ProvisionState> {
  const response = await authFetch(ROUTE, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
    ...(method === "POST"
      ? { method, headers: { "content-type": "application/json" }, body: "{}" }
      : {}),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Your bot's setup could not be read.");
  return checkProvisionState(value);
}

const ICON: Record<StepState, typeof Check> = {
  done: Check,
  current: Loader2,
  pending: Circle,
  failed: AlertTriangle,
};

function Steps({ state }: { state: ProvisionState }) {
  return (
    <ol className="setup-steps">
      {PROVISION_STAGES.map((stage: ProvisionStage) => {
        const step = stageStatus(state, stage);
        const Icon = ICON[step];
        return (
          <li
            key={stage}
            className={`setup-step is-${step}`}
            aria-current={step === "current" ? "step" : undefined}
          >
            <Icon size={17} aria-hidden className={step === "current" ? "setup-spinner" : undefined} />
            <span>{STAGE_LABEL[stage]}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function CreateBot({ workspace, enabled, next = { href: "/lines", label: "Link your WhatsApp number" } }: {
  workspace: { id: string; name: string };
  /** Whether this console can create a bot at all. Unset, there is only the
   *  workspace ID to hand to whoever is setting one up. */
  enabled: boolean;
  /** Where a finished run hands over to: the Lines page, or the wizard's next step. */
  next?: { href: string; label: string };
}) {
  const [state, setState] = useState<ProvisionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // `busy` is for the button's label; this is what actually holds the door.
  // Two clicks in one React batch both see the old state, and starting a bot is
  // not a request to send twice on the strength of the server refusing it.
  const starting = useRef(false);

  /**
   * A finished run leaves this page able to redirect to the console, so it is
   * deliberately not refreshed here: being thrown off the screen that just said
   * what to do next is no way to be told to go and link WhatsApp. The link does
   * it, and a reload sends them on as usual.
   */
  const settle = useCallback((next: ProvisionState) => {
    setState(next);
    setError(null);
  }, []);

  const read = useCallback(async () => {
    try { settle(await request("GET")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Your bot's setup could not be read."); }
  }, [settle]);

  // Read before drawing anything: a reload part-way through a run, or a second
  // tab, joins it where it is rather than offering to start another.
  usePolling(read, POLL_MS, enabled && state?.status !== "ready" && state?.status !== "failed");

  async function create() {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    setError(null);
    try { settle(await request("POST")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Your bot could not be created."); }
    finally { starting.current = false; setBusy(false); }
  }

  if (!enabled) {
    return (
      <section className="card card-pad">
        <h2 className="card-title">No bot connected yet</h2>
        <p className="card-note">
          Each workspace runs its own WhatsApp bot, and only you can see this workspace&apos;s data.
          Once your bot is set up and connected, this console shows its groups, campaigns, schedule and lines.
        </p>
        <dl className="card-note">
          <dt>Workspace</dt><dd>{workspace.name}</dd>
          <dt>Workspace ID</dt><dd><code>{workspace.id}</code></dd>
        </dl>
        <p className="card-note">Share the workspace ID with whoever is setting up your bot.</p>
      </section>
    );
  }

  return (
    <>
      {error ? <div className="banner" role="alert"><AlertTriangle size={17} aria-hidden /><span>{error}</span></div> : null}

      <section className="card card-pad">
        {state?.status === "ready" ? (
          <>
            <h2 className="card-title">Your bot is ready</h2>
            {state.simulated ? (
              <p className="card-note">
                This run was simulated: no bot was created, because this console has no provisioner
                configured. Connect one with <code>scripts/workspace-admin.mjs connect-bot</code> to
                use the rest of the console.
              </p>
            ) : (
              <p className="card-note">
                Next, link the WhatsApp number it will post from. You scan a QR code with the phone
                that holds the account, the same way WhatsApp links any other device.
              </p>
            )}
            <div className="setup-actions">
              <Link prefetch={false} className="btn btn-primary" href={next.href}>{next.label}</Link>
            </div>
          </>
        ) : state?.status === "failed" ? (
          <>
            <h2 className="card-title">Your bot could not be created</h2>
            <Steps state={state} />
            <p className="card-note">{state.detail}</p>
            <div className="setup-actions">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void create()}>
                {busy ? "Trying again…" : "Try again"}
              </button>
            </div>
          </>
        ) : state?.status === "running" ? (
          <>
            <h2 className="card-title">Creating your bot</h2>
            <p className="card-note">This takes a few minutes. Keep this page open while it finishes.</p>
            <div role="status" aria-live="polite">
              <Steps state={state} />
            </div>
          </>
        ) : (
          <>
            <h2 className="card-title">Create your bot</h2>
            <p className="card-note">
              Each workspace runs its own WhatsApp bot, and only you can see this workspace&apos;s data.
              Creating it sets up its config and connects it to your workspace; after that you link the
              WhatsApp number it posts from, and this console shows its groups, campaigns and schedule.
            </p>
            <div className="setup-actions">
              <button type="button" className="btn btn-primary" disabled={busy || (state === null && !error)} onClick={() => void create()}>
                {busy ? "Creating…" : "Create my bot"}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="card card-pad">
        <h2 className="card-title">Your workspace</h2>
        <dl className="card-note">
          <dt>Workspace</dt><dd>{workspace.name}</dd>
          <dt>Workspace ID</dt><dd><code>{workspace.id}</code></dd>
        </dl>
      </section>
    </>
  );
}
