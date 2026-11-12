"use client";

import { useState, useTransition } from "react";
import { setDisplayTimezoneAction } from "@/app/settings/actions";
import { BOT_TIMEZONE } from "@/src/config";
import { DISPLAY_TIMEZONES } from "@/src/lib/timezone";

export const TIMEZONE_EXPLAINER =
  "Which clock the console is read on. Every time on every screen -- the campaign day, run times, when something was last seen -- is shown in the zone chosen here.";
export const TIMEZONE_SCOPE_NOTE =
  `This changes what you see and nothing else. Campaigns keep going out when they already do, planned in ${BOT_TIMEZONE}, and the choice stays in this browser.`;

export function DisplayTimezoneForm({ zone }: { zone: string }) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function choose(next: string) {
    if (next === zone) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const outcome = await setDisplayTimezoneAction(next);
      if (outcome.ok) setSaved(true);
      else setError(outcome.detail);
    });
  }

  return (
    <section className="card card-pad" aria-labelledby="display-timezone-title">
      <h2 className="card-title" id="display-timezone-title">Time zone</h2>
      <p className="card-note">{TIMEZONE_EXPLAINER}</p>

      <fieldset className="cap-settings-fields" disabled={pending}>
        <div className="form-field">
          <label className="modal-label" htmlFor="display-timezone">Show times in</label>
          <select id="display-timezone" className="modal-input" value={zone}
            onChange={(event) => choose(event.target.value)}>
            {DISPLAY_TIMEZONES.map((option) => (
              <option key={option.zone} value={option.zone}>{option.label}</option>
            ))}
          </select>
        </div>
      </fieldset>

      <p className="card-note">{TIMEZONE_SCOPE_NOTE}</p>
      {error ? <p className="caption-error" role="alert">{error}</p> : null}
      {saved && !error ? <p className="card-note" role="status">Saved. Every screen now shows {zone}.</p> : null}
    </section>
  );
}
