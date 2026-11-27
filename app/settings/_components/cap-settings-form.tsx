"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/app/_components/confirm-dialog";
import { Section } from "@/app/_components/ui";
import { saveCapSettingsAction } from "@/app/settings/actions";
import {
  MAX_DAILY_CAP, capChange, capDraftProblems, describeCapChange, draftFromSettings, storedSettings,
  type CapDraft,
} from "@/src/domains/cap-settings";
import type { WriteGate } from "@/src/lib/write-capabilities";
import type { CapSettings } from "@/src/lib/types";

export const CAPS_EXPLAINER =
  "How many adverts each group gets a day. A group's tier sets the range; when more campaigns target it than it allows, they take turns.";
export const ROTATION_OFF_NOTE =
  "With turns off, the same campaigns are held back every day — and they stop posting to that group until this is switched back on.";
export const NEXT_RUN_NOTE = "Changes apply from each campaign's next run.";

export function CapSettingsForm({ settings, gate, rotationGate }: {
  settings: CapSettings;
  gate: WriteGate;
  /** The rotation switch is a separate field to the bot, so it carries its own
   *  gate: an older bot refuses it by name while accepting the rest. */
  rotationGate?: WriteGate;
}) {
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
  const rotationEditable = editable && (rotationGate?.allowed ?? true);

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

  const tiers = Object.keys(settings.bands);
  const bandInput = (tier: string, end: 0 | 1) => (
    <input className="modal-input" inputMode="numeric" type="number" min={0} max={MAX_DAILY_CAP} step={1}
      aria-label={`${tier} ${end === 0 ? "at least" : "at most"}`}
      value={draft.bands[tier][end]}
      onChange={(event) => setBand(tier, end, event.target.value)} />
  );
  const footer = (
    <>
      <div className="setting-foot-text">
        {problems.length > 0 ? (
          <ul className="modal-error" role="alert">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
        ) : !gate.allowed ? <p>{gate.reason}</p> : saved ? null : <p>{NEXT_RUN_NOTE}</p>}
        <p className="setting-status" role="status">{saved ? `Saved. ${NEXT_RUN_NOTE}` : ""}</p>
      </div>
      <div className="section-foot-end setting-foot-actions">
        <button type="button" className="btn" disabled={!editable || changes.length === 0}
          onClick={() => { setDraft(draftFromSettings(settings)); setError(null); }}>Reset</button>
        <button type="button" className="btn btn-primary"
          disabled={!editable || changes.length === 0 || problems.length > 0}
          title={gate.allowed ? undefined : gate.reason}
          onClick={() => setConfirming(true)}>Save changes</button>
      </div>
    </>
  );

  return (
    <Section id="cap-settings" className="cap-settings" title="Daily caps" description={CAPS_EXPLAINER}
      busy={pending} footer={footer}>
      <fieldset className="setting-fields" disabled={!editable}>
        <label className="setting-row is-toggle">
          <span className="setting-label">
            <span className="setting-name">Cap how many adverts each group gets a day</span>
            <span className="setting-hint">Each group's tier sets its range, below.</span>
          </span>
          <span className="setting-control">
            <input type="checkbox" className="setting-switch" checked={draft.enabled}
              onChange={(event) => update({ enabled: event.target.checked })} />
          </span>
        </label>
        {draft.enabled ? (
          <>
            {/* Only while caps are on: with them off nothing is ever held back,
                so there are no turns to take and the control would be inert. */}
            <label className="setting-row is-toggle">
              <span className="setting-label">
                <span className="setting-name">Let a capped group&apos;s campaigns take turns</span>
                <span className="setting-hint">So a full group still sees every campaign over a few days.</span>
              </span>
              <span className="setting-control">
                <input type="checkbox" className="setting-switch" checked={draft.rotation} disabled={!rotationEditable}
                  onChange={(event) => update({ rotation: event.target.checked })} />
              </span>
            </label>
            {/* Only when this one field is the thing standing in the way. A
                form that is read-only altogether has already said so once, and
                saying it again beside one checkbox suggests a second cause. */}
            {gate.allowed && rotationGate && !rotationGate.allowed ? (
              <p className="setting-callout">{rotationGate.reason}</p>
            ) : null}
            {!draft.rotation ? <p className="setting-callout is-warning">{ROTATION_OFF_NOTE}</p> : null}
          </>
        ) : (
          <p className="setting-callout">With caps off, every campaign that targets a group posts there every day.</p>
        )}

        <div className="setting-row">
          <div className="setting-label">
            <label className="setting-name" htmlFor="cap-default-tier">Tier for groups without one</label>
            <span className="setting-hint">Picks the band below for a group you haven&apos;t tiered.</span>
          </div>
          <div className="setting-control">
            <select id="cap-default-tier" className="modal-input" value={draft.defaultActivity}
              onChange={(event) => update({ defaultActivity: event.target.value })}>
              {tiers.map((tier) => <option key={tier} value={tier}>{tier}</option>)}
            </select>
          </div>
        </div>

        <div className="setting-row is-stacked">
          <div className="setting-label">
            <span className="setting-name" id="cap-bands-title">Adverts a day, for each tier</span>
            <span className="setting-hint">Replies to a group&apos;s adverts move its allowance between these two numbers.</span>
          </div>
          <div className="cap-bands" role="table" aria-labelledby="cap-bands-title">
            <div className="cap-bands-head" role="row">
              <span role="columnheader">Tier</span>
              <span role="columnheader">At least</span>
              <span aria-hidden="true" />
              <span role="columnheader">At most</span>
              <span aria-hidden="true" />
            </div>
            {tiers.map((tier) => (
              <div className="cap-bands-row" role="row" key={tier}>
                <span role="rowheader"><span className="cap-tier">{tier}</span></span>
                <span role="cell">{bandInput(tier, 0)}</span>
                <span className="cap-bands-dash" aria-hidden="true">–</span>
                <span role="cell">{bandInput(tier, 1)}</span>
                <span className="cap-bands-unit" aria-hidden="true">a day</span>
              </div>
            ))}
          </div>
        </div>
      </fieldset>

      {confirming && gate.allowed ? (
        <ConfirmDialog title="Save cap settings?" confirmLabel="Save" warning={gate.warning}
          pending={pending} error={error} onConfirm={save}
          onClose={() => { setConfirming(false); setError(null); }}>
          <ul>{changes.map((line) => <li key={line}>{line}</li>)}</ul>
          <p>These decide what every campaign sends. {NEXT_RUN_NOTE}</p>
        </ConfirmDialog>
      ) : null}
    </Section>
  );
}
