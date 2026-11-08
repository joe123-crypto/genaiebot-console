"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/app/_components/confirm-dialog";
import { saveCapSettingsAction } from "@/app/settings/actions";
import {
  MAX_DAILY_CAP, capChange, capDraftProblems, describeCapChange, draftFromSettings, storedSettings,
  type CapDraft,
} from "@/src/domains/cap-settings";
import type { WriteGate } from "@/src/lib/write-capabilities";
import type { CapSettings } from "@/src/lib/types";

export const CAPS_EXPLAINER =
  "Every group gets a daily allowance of adverts. Its tier picks a band, and replies to its adverts move the allowance inside that band. When a group's allowance is smaller than the number of campaigns that target it, the campaigns take turns.";
export const NEXT_RUN_NOTE = "Changes apply from each campaign's next run.";

export function CapSettingsForm({ settings, gate }: { settings: CapSettings; gate: WriteGate }) {
  const [draft, setDraft] = useState<CapDraft>(() => draftFromSettings(settings));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<{ detail: string; problems?: string[] } | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  // When the bot's settings change under the form -- this save landing, or
  // another tab's -- start again from them. Keeps the "Saved" note, which a
  // remount would lose.
  const settingsKey = JSON.stringify(settings);
  const [loadedKey, setLoadedKey] = useState(settingsKey);
  if (loadedKey !== settingsKey) {
    setLoadedKey(settingsKey);
    setDraft(draftFromSettings(settings));
  }

  const problems = capDraftProblems(draft, settings);
  const change = problems.length === 0 ? capChange(draft, settings) : {};
  const changes = describeCapChange(change, settings);
  const editable = gate.allowed && !pending;

  function update(next: Partial<CapDraft>) {
    setDraft((current) => ({ ...current, ...next }));
    setSaved(false);
    setError(null);
  }

  function setBand(tier: string, end: 0 | 1, value: string) {
    setDraft((current) => {
      const band: [string, string] = [...current.bands[tier]];
      band[end] = value;
      return { ...current, bands: { ...current.bands, [tier]: band } };
    });
    setSaved(false);
    setError(null);
  }

  function save() {
    startTransition(async () => {
      const outcome = await saveCapSettingsAction(draft, storedSettings(settings));
      if (outcome.ok) {
        setConfirming(false);
        setSaved(true);
      } else {
        setError({ detail: outcome.detail, problems: outcome.problems });
      }
    });
  }

  return (
    <section className="card card-pad cap-settings" aria-labelledby="cap-settings-title">
      <h2 className="card-title" id="cap-settings-title">Daily caps</h2>
      <p className="card-note">{CAPS_EXPLAINER}</p>
      {!gate.allowed ? <p className="card-note">{gate.reason}</p> : null}

      <fieldset className="cap-settings-fields" disabled={!editable}>
        <label className="cap-settings-switch">
          <input type="checkbox" checked={draft.enabled}
            onChange={(event) => update({ enabled: event.target.checked })} />
          Cap how many adverts each group gets a day
        </label>
        {!draft.enabled ? (
          <p className="card-note">With caps off, every campaign that targets a group posts there every day.</p>
        ) : null}

        <div className="form-field">
          <label className="modal-label" htmlFor="cap-default-tier">Tier for groups without one</label>
          <select id="cap-default-tier" className="modal-input" value={draft.defaultActivity}
            onChange={(event) => update({ defaultActivity: event.target.value })}>
            {Object.keys(settings.bands).map((tier) => <option key={tier} value={tier}>{tier}</option>)}
          </select>
        </div>

        <table className="data cap-settings-bands">
          <caption className="card-note">Adverts a day, for each tier</caption>
          <thead><tr><th scope="col">Tier</th><th scope="col">At least</th><th scope="col">At most</th></tr></thead>
          <tbody>
            {Object.keys(settings.bands).map((tier) => (
              <tr key={tier}>
                <th scope="row">{tier}</th>
                {([0, 1] as const).map((end) => (
                  <td key={end}>
                    <input className="modal-input" inputMode="numeric" type="number" min={0} max={MAX_DAILY_CAP} step={1}
                      aria-label={`${tier} ${end === 0 ? "at least" : "at most"}`}
                      value={draft.bands[tier][end]}
                      onChange={(event) => setBand(tier, end, event.target.value)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>

      {problems.length > 0 ? (
        <ul className="modal-error" role="alert">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
      ) : null}
      {saved ? <p className="card-note" role="status">Saved. {NEXT_RUN_NOTE}</p> : null}

      <div className="modal-actions">
        <button type="button" className="btn" disabled={!editable || changes.length === 0}
          onClick={() => { setDraft(draftFromSettings(settings)); setError(null); }}>Reset</button>
        <button type="button" className="btn btn-primary"
          disabled={!editable || changes.length === 0 || problems.length > 0}
          title={gate.allowed ? undefined : gate.reason}
          onClick={() => setConfirming(true)}>Save changes</button>
      </div>

      {confirming && gate.allowed ? (
        <ConfirmDialog title="Save cap settings?" confirmLabel="Save" warning={gate.warning}
          pending={pending} error={error} onConfirm={save}
          onClose={() => { setConfirming(false); setError(null); }}>
          <ul>{changes.map((line) => <li key={line}>{line}</li>)}</ul>
          <p>These decide what every campaign sends. {NEXT_RUN_NOTE}</p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
