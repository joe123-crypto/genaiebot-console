import { cookies } from "next/headers";
import { THEME_COOKIE_NAME } from "@/src/config";
import { DEFAULT_THEME, isTheme, type Theme } from "@/src/lib/theme";

/**
 * Whether to render this request light or dark. Read on the server so the
 * first paint is already in the chosen theme and nothing flashes light before
 * React takes over. An unset or unrecognised cookie reads as light.
 */
export async function displayTheme(): Promise<Theme> {
  try {
    const value = (await cookies()).get(THEME_COOKIE_NAME)?.value;
    return isTheme(value) ? value : DEFAULT_THEME;
  } catch {
    // No request to read a cookie from -- a prerender, or a page rendered in a
    // test. Light is what the console showed before there was a choice.
    return DEFAULT_THEME;
  }
}
