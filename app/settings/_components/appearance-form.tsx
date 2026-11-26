"use client";

import { useState, useTransition } from "react";
import { setThemeAction } from "@/app/settings/actions";
import { THEMES, isTheme, themeAttribute, type Theme } from "@/src/lib/theme";

export const APPEARANCE_EXPLAINER =
  "How the console looks in this browser. Dark is easier on the eyes at night; light is what every screen showed before there was a choice.";
export const APPEARANCE_SCOPE_NOTE =
  "Only this browser changes. Other operators, and your other devices, keep their own choice.";

const UNSAVED = "The theme could not be saved. Try again.";

/** Paint a theme now rather than when the server's re-render arrives, so the
 *  switch is instant. The server renders the same attribute from the cookie. */
function paint(theme: Theme) {
  const attribute = themeAttribute(theme);
  if (attribute) document.documentElement.dataset.theme = attribute;
  else delete document.documentElement.dataset.theme;
}

export function AppearanceForm({ theme }: { theme: Theme }) {
  const [shown, setShown] = useState<Theme>(theme);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function choose(next: string) {
    if (!isTheme(next) || next === shown) return;
    const previous = shown;
    setError(null);
    setSaved(false);
    setShown(next);
    paint(next);
    startTransition(async () => {
      const outcome = await setThemeAction(next).catch(() => ({ ok: false as const, detail: UNSAVED }));
      if (outcome.ok) {
        setSaved(true);
        return;
      }
      // The cookie was not set, so the next page would paint the old theme.
      // Go back to it now rather than let this page disagree with the next.
      setShown(previous);
      paint(previous);
      setError(outcome.detail);
    });
  }

  const label = THEMES.find((option) => option.value === shown)?.label ?? shown;

  return (
    <section className="card card-pad" aria-labelledby="appearance-title">
      <h2 className="card-title" id="appearance-title">Appearance</h2>
      <p className="card-note">{APPEARANCE_EXPLAINER}</p>

      <fieldset className="cap-settings-fields" disabled={pending}>
        <div className="form-field">
          <label className="modal-label" htmlFor="appearance-theme">Theme</label>
          <select id="appearance-theme" className="modal-input" value={shown}
            onChange={(event) => choose(event.target.value)}>
            {THEMES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </fieldset>

      <p className="card-note">{APPEARANCE_SCOPE_NOTE}</p>
      {error ? <p className="caption-error" role="alert">{error}</p> : null}
      {saved && !error ? <p className="card-note" role="status">Saved. The console now shows {label.toLowerCase()}.</p> : null}
    </section>
  );
}
