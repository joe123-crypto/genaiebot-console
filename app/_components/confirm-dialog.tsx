"use client";

import { useId, type ReactNode } from "react";

/**
 * A yes-or-no question before a change that reaches the bot.
 *
 * The caller owns the outcome: it passes `pending` while the change is in
 * flight and `error` when the bot refused, so the dialog stays open on the
 * reason rather than closing over it. Cancel is focused first, so Enter on an
 * accidental open does nothing.
 */
export function ConfirmDialog({
  title, children, warning, confirmLabel, danger = false, pending = false, error, onConfirm, onClose,
}: {
  title: string;
  children: ReactNode;
  /** The write gate's warning, when a save would not reach the campaigns. */
  warning?: string;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  error?: { detail: string; problems?: string[] } | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const close = () => { if (!pending) onClose(); };
  return (
    <div className="modal-backdrop" role="presentation" onClick={close}
      onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
      <div className="modal" role="alertdialog" aria-modal="true"
        aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`}
        onClick={(event) => event.stopPropagation()}>
        <h2 className="modal-title" id={`${id}-title`}>{title}</h2>
        <div className="modal-body" id={`${id}-body`}>{children}</div>
        {warning ? <p className="modal-warning">{warning}</p> : null}
        {error ? (
          <div className="modal-error" role="alert">
            <p>{error.detail}</p>
            {error.problems?.length ? <ul>{error.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : null}
          </div>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close} disabled={pending} autoFocus>Cancel</button>
          <button type="button" className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm} disabled={pending}>
            {pending ? "Saving…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
