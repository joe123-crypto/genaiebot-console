"use client";

import { useState, useTransition } from "react";
import { setDisplayTimezoneAction } from "@/app/settings/actions";
import { DISPLAY_TIMEZONES } from "@/src/lib/timezone";

export const TIMEZONE_EXPLAINER =
  "Campaign days, run times and last-seen times are all read on this clock.";

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
    <div className="setting-row" aria-busy={pending || undefined}>
      <div className="setting-label">
        <label className="setting-name" htmlFor="display-timezone">Time zone</label>
        <span className="setting-hint">{TIMEZONE_EXPLAINER}</span>
        {error ? <span className="caption-error" role="alert">{error}</span> : null}
        <span className="setting-status" role="status">{saved && !error ? `Saved. Every screen now shows ${zone}.` : ""}</span>
      </div>
      <div className="setting-control">
        <select id="display-timezone" className="modal-input" value={zone} disabled={pending}
          onChange={(event) => choose(event.target.value)}>
          {DISPLAY_TIMEZONES.map((option) => (
            <option key={option.zone} value={option.zone}>{option.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
