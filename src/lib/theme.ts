/**
 * The two ways the console can be read. Light is what every screen showed
 * before there was a choice, so it is what an unset or unrecognised choice
 * means. Safe to import from the browser: it reads no cookie itself.
 */
export const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

export type Theme = (typeof THEMES)[number]["value"];

export const DEFAULT_THEME: Theme = "light";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && THEMES.some((entry) => entry.value === value);
}

/** What `<html data-theme>` carries for a theme. Light is the stylesheet's own
 *  `:root`, so it carries nothing; only dark has a block to switch on. */
export function themeAttribute(theme: Theme): "dark" | undefined {
  return theme === "dark" ? "dark" : undefined;
}
