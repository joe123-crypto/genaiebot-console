import { cookies } from "next/headers";
import { BOT_TIMEZONE, TIMEZONE_COOKIE_NAME } from "@/src/config";
import { isDisplayTimezone, type DisplayTimezone } from "@/src/lib/timezone";

/**
 * Which clock to render this request on. Read on the server so the first paint
 * is already in the chosen zone and nothing flips an hour once React takes over.
 * An unset or unrecognised cookie reads as the bot's own zone, which is what
 * every screen showed before there was a choice.
 */
export async function displayTimezone(): Promise<DisplayTimezone | string> {
  try {
    const value = (await cookies()).get(TIMEZONE_COOKIE_NAME)?.value;
    return isDisplayTimezone(value) ? value : BOT_TIMEZONE;
  } catch {
    // No request to read a cookie from -- a prerender, or a page rendered in a
    // test. The bot's own zone is what the console showed before there was a
    // choice, so that is what a page without one shows.
    return BOT_TIMEZONE;
  }
}
