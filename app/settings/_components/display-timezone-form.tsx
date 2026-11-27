"use client";

import { useState, useTransition } from "react";
import { setDisplayTimezoneAction } from "@/app/settings/actions";
import { Section } from "@/app/_components/ui";
import { BOT_TIMEZONE } from "@/src/config";
import { DISPLAY_TIMEZONES } from "@/src/lib/timezone";

export const TIMEZONE_EXPLAINER =
  "The clock every date and time in the console is read on.";
export const TIMEZONE_SCOPE_NOTE =
  `Only what you see changes. Campaigns still go out on ${BOT_TIMEZONE} time, and the choice stays in this browser.`;

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

  const footer = (
    <>
      {error ? <p className="caption-error" role="alert">{error}</p> : <p>{TIMEZONE_SCOPE_NOTE}</p>}
      <p className="setting-status" role="status">{saved && !error ? `Saved. Every screen now shows ${zone}.` : ""}</p>
    </>
  );

  return (
    <Section id="display-timezone" title="Time zone" description={TIMEZONE_EXPLAINER}
      busy={pending} footer={footer}>
      <fieldset className="setting-fields" disabled={pending}>
        <div className="setting-row">
          <div className="setting-label">
            <label htmlFor="display-timezone">Show times in</label>
            <span className="setting-hint">Campaign days, run times, last seen</span>
          </div>
          <div className="setting-control">
            <select id="display-timezone" className="modal-input" value={zone}
              onChange={(event) => choose(event.target.value)}>
              {DISPLAY_TIMEZONES.map((option) => (
                <option key={option.zone} value={option.zone}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>
    </Section>
  );
}
