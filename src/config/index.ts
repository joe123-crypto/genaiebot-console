/**
 * The console never holds its own copy of operator state. It either shells out
 * to a local genaebot checkout (development) or calls the console API running
 * beside the gateway on Railway (production). Everything here picks between
 * those two and nothing else.
 */

export const PRODUCT_NAME = "Genaie Console";

/** Where the bot's own tooling lives when we read it locally. */
export const GENAEBOT_CHECKOUT =
  process.env.GENAEBOT_CHECKOUT?.trim() || "/home/joseph/projects/genaebot";

/** Base URL of the console API inside the gateway container. */
export const BOT_API_BASE_URL = process.env.BOT_API_BASE_URL?.trim() || "";

/** Bearer fallback for the console API when Vercel OIDC is not in play. */
export const BOT_API_TOKEN = process.env.BOT_API_TOKEN?.trim() || "";

export type BotSource = "local" | "remote";

/**
 * Remote wins whenever it is configured, so a deployed console can never
 * silently fall back to reading a checkout that is not there.
 */
export const BOT_SOURCE: BotSource = BOT_API_BASE_URL ? "remote" : "local";

/** Campaign sends are planned in Harare time; so is every slot the UI shows. */
export const BOT_TIMEZONE = "Africa/Harare";

export const SESSION_COOKIE_NAME = "genaie_console_session";
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
