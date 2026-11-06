/**
 * The console never holds its own copy of operator state. It either shells out
 * to a local genaebot checkout (development) or calls the console API running
 * beside the gateway on Railway (production). Everything here picks between
 * those two and nothing else.
 */

export const PRODUCT_NAME = "Genaie Console";

/**
 * Who the console says is acting. There is no session to read a name from yet,
 * so it is a constant — but it lives here rather than in the sidebar, so the
 * name on screen and the name recorded against a delete cannot drift apart.
 */
export const OPERATOR_NAME = "Joseph Munemo";

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

/**
 * The write API. It is a separate service from the read one, on its own port
 * and behind its own token: the read API is read-only by construction and
 * refuses every method but GET and HEAD, and that property is worth keeping.
 */
export const BOT_WRITE_API_BASE_URL = process.env.BOT_WRITE_API_BASE_URL?.trim() || "";
export const BOT_WRITE_TOKEN = process.env.BOT_WRITE_TOKEN?.trim() || "";

/** Chosen the same way as BOT_SOURCE, so a write and a read cannot disagree
 *  about which genaebot they are talking to. */
export const WRITE_SOURCE: BotSource = BOT_WRITE_API_BASE_URL ? "remote" : "local";

/**
 * Writes are opt-in and off by default.
 *
 * The console still has no login: anyone who can load the page can use
 * anything it offers. That is survivable while every screen is read-only, and
 * it is not survivable for a delete, so this flag — not a session — is what
 * keeps a deployed console harmless. Leave CONSOLE_WRITES unset in production
 * and the console stays exactly the viewer it has always been. Turning it on
 * there is a decision that waits for authentication.
 *
 * A target still has to be configured, so setting the flag alone cannot arm a
 * button that has nothing to call.
 */
export const WRITES_ENABLED =
  process.env.CONSOLE_WRITES?.trim() === "1" &&
  (WRITE_SOURCE === "remote" ? Boolean(BOT_WRITE_TOKEN) : Boolean(GENAEBOT_CHECKOUT));

/** Campaign sends are planned in Harare time; so is every slot the UI shows. */
export const BOT_TIMEZONE = "Africa/Harare";

export const SESSION_COOKIE_NAME = "genaie_console_session";
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
