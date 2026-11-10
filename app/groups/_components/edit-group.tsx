"use client";

import { useState, useTransition } from "react";
import { notifyLiveChange } from "@/app/_components/use-live";
import { Pencil } from "lucide-react";
import { updateGroupAction } from "@/app/groups/actions";
import {
  GROUP_FIELD_LABEL,
  GROUP_STATUSES,
  currentGroupValues,
  type GroupEdit,
  type GroupEditField,
} from "@/src/domains/group-edit";
import { STATUS_LABEL } from "@/app/_components/ui";
import type { WriteGate } from "@/src/lib/write-capabilities";
import type { Group } from "@/src/lib/types";

export const NEXT_RUN_NOTE = "Changes take effect from each campaign's next run.";

type Draft = Record<GroupEditField, string>;

/** Form controls hold text; the bot's values can be null or a number. */
function asDraft(group: Group): Draft {
  const values = currentGroupValues(group);
  return {
    name: values.name === null ? "" : String(values.name),
    status: String(values.status),
    activity: String(values.activity),
    account: String(values.account),
    daily_cap: values.daily_cap === null ? "" : String(values.daily_cap),
    note: values.note === null ? "" : String(values.note),
  };
}

/**
 * What the operator actually changed, and what each of those fields showed when
 * the dialog opened. Only these are sent: a field left alone is never written,
 * and so can never trip the stale-edit check because someone else changed it.
 */
export function touchedFields(group: Group, draft: Draft): { form: GroupEdit; expected: GroupEdit } {
  const initial = asDraft(group);
  const original = currentGroupValues(group);
  const form: GroupEdit = {};
  const expected: GroupEdit = {};
  for (const field of Object.keys(initial) as GroupEditField[]) {
    if (draft[field].trim() !== initial[field].trim()) {
      form[field] = draft[field];
      expected[field] = original[field];
    }
  }
  return { form, expected };
}

type Props = {
  group: Group;
  label: string;
  lines: string[];
  tiers: string[];
  gate: WriteGate;
  /** The fields the bot accepts; anything else in the form is shown, disabled. */
  editable: string[];
  initiallyOpen?: boolean;
  onDismiss?: () => void;
};

export function EditGroup({ group, label, lines, tiers, gate, editable, initiallyOpen = false, onDismiss }: Props) {
  const [open, setOpen] = useState(initiallyOpen);
  // The group as it was when the dialog opened. The page refreshes every
  // minute; diffing the form against a refreshed `group` would mistake someone
  // else's change for this operator's edit, send it back with their value as
  // "expected", pass the stale check, and quietly revert them.
  const [opened, setOpened] = useState<Group>(group);
  const [draft, setDraft] = useState<Draft>(() => asDraft(group));
  const [error, setError] = useState<{ detail: string; problems?: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  const { form } = touchedFields(open ? opened : group, draft);
  const dirty = Object.keys(form).length > 0;
  const accepts = new Set(editable);
  const id = `edit-${group.jid}`;

  function openDialog() {
    // Start from what the row shows now, not from a draft left behind by a
    // dialog that was cancelled before the last refresh.
    setOpened(group);
    setDraft(asDraft(group));
    setError(null);
    setOpen(true);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    onDismiss?.();
    setError(null);
  }

  function set(field: GroupEditField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function submit() {
    if (!dirty || pending || !gate.allowed) return;
    const { form: change, expected } = touchedFields(opened, draft);
    startTransition(async () => {
      const outcome = await updateGroupAction(group.jid, change, expected);
      if (outcome.ok) {
        notifyLiveChange();
        setOpen(false);
        onDismiss?.();
        setError(null);
        return;
      }
      setError({ detail: outcome.detail, problems: outcome.problems });
    });
  }

  function control(field: GroupEditField, input: React.ReactNode) {
    const off = !accepts.has(field);
    return (
      <div className="form-field" key={field} title={off ? `The bot does not accept changes to ${GROUP_FIELD_LABEL[field].toLowerCase()} yet.` : undefined}>
        <label className="modal-label" htmlFor={`${id}-${field}`}>{GROUP_FIELD_LABEL[field]}</label>
        {input}
      </div>
    );
  }

  const disabled = (field: GroupEditField) => pending || !gate.allowed || !accepts.has(field);

  return (
    <>
      <button
        type="button"
        className="row-action"
        onClick={openDialog}
        disabled={!gate.allowed}
        title={gate.allowed ? undefined : gate.reason}
        aria-label={`Edit ${label}`}
      >
        <Pencil size={15} aria-hidden />
      </button>

      {open ? (
        <div className="modal-backdrop" role="presentation" onClick={close}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => { if (event.key === "Escape") close(); }}
          >
            <h2 className="modal-title" id={`${id}-title`}>Edit {label}</h2>
            <p className="modal-body">{NEXT_RUN_NOTE}</p>
            {gate.allowed && gate.warning ? <p className="modal-warning">{gate.warning}</p> : null}

            {control("name", (
              <input id={`${id}-name`} className="modal-input" value={draft.name}
                     disabled={disabled("name")} autoComplete="off"
                     onChange={(event) => set("name", event.target.value)} />
            ))}
            {control("status", (
              <select id={`${id}-status`} className="modal-input" value={draft.status}
                      disabled={disabled("status")}
                      onChange={(event) => set("status", event.target.value)}>
                {GROUP_STATUSES.map((status) => (
                  <option key={status} value={status}>{STATUS_LABEL[status]}</option>
                ))}
              </select>
            ))}
            {control("activity", (
              <select id={`${id}-activity`} className="modal-input" value={draft.activity}
                      disabled={disabled("activity")}
                      onChange={(event) => set("activity", event.target.value)}>
                {tiers.map((tier) => <option key={tier} value={tier}>{tier}</option>)}
              </select>
            ))}
            {control("account", (
              <select id={`${id}-account`} className="modal-input" value={draft.account}
                      disabled={disabled("account")}
                      onChange={(event) => set("account", event.target.value)}>
                {lines.map((line) => <option key={line} value={line}>{line}</option>)}
              </select>
            ))}
            {control("daily_cap", (
              <input id={`${id}-daily_cap`} className="modal-input" type="number" min={0} step={1}
                     inputMode="numeric" placeholder="Blank: use the tier's band"
                     value={draft.daily_cap} disabled={disabled("daily_cap")}
                     onChange={(event) => set("daily_cap", event.target.value)} />
            ))}
            {control("note", (
              <textarea id={`${id}-note`} className="modal-input" rows={3} maxLength={500}
                        value={draft.note} disabled={disabled("note")}
                        onChange={(event) => set("note", event.target.value)} />
            ))}

            {error ? (
              <div className="modal-error" role="alert">
                <p>{error.detail}</p>
                {error.problems?.length ? (
                  <ul>{error.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
                ) : null}
              </div>
            ) : null}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={close} disabled={pending}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={submit}
                      disabled={!dirty || pending || !gate.allowed}>
                {pending ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
