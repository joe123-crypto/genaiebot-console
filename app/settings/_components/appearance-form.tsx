"use client";

import { useState, useTransition } from "react";
import { setThemeAction } from "@/app/settings/actions";
import { Section } from "@/app/_components/ui";
import { THEMES, isTheme, themeAttribute, type Theme } from "@/src/lib/theme";

export const APPEARANCE_EXPLAINER =
  "How the console looks in this browser. Dark is easier on the eyes at night.";
export const APPEARANCE_SCOPE_NOTE =
  "Only this browser changes. Other operators and your other devices keep their own choice.";

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
  const footer = (
    <>
      {error ? <p className="caption-error" role="alert">{error}</p> : <p>{APPEARANCE_SCOPE_NOTE}</p>}
      <p className="setting-status" role="status">{saved && !error ? `Saved. The console now shows ${label.toLowerCase()}.` : ""}</p>
    </>
  );

  return (
    <Section id="appearance" title="Appearance" description={APPEARANCE_EXPLAINER} busy={pending} footer={footer}>
      {/* Real radios, so arrow keys move between the two and a screen reader
          hears "Theme, Dark, 2 of 2". The picture is decoration. */}
      <fieldset className="theme-choices" disabled={pending}>
        <legend className="sr-only">Theme</legend>
        {THEMES.map((option) => (
          <label key={option.value} className={`theme-choice is-${option.value}`}>
            <span className="theme-preview" aria-hidden="true">
              <span className="theme-preview-nav"><i /><i /><i /></span>
              <span className="theme-preview-main"><i /><i /><b /></span>
            </span>
            <span className="theme-choice-label">
              <input type="radio" name="appearance-theme" value={option.value}
                checked={shown === option.value} onChange={(event) => choose(event.target.value)} />
              {option.label}
            </span>
          </label>
        ))}
      </fieldset>
    </Section>
  );
}
