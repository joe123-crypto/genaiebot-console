/**
 * The console never holds its own copy of operator state. It either shells out
 * to a local genaebot checkout (development) or calls the console API running
 * beside the gateway on Railway (production). Everything here picks between
 * those two and nothing else.
 */

export const PRODUCT_NAME = "Genaie";

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
 * Where config edits go. The bot serves them from the same console API as the
 * reads -- `POST /internal/console/config/...`, behind the same token -- so by
 * default a write goes exactly where the reads come from. Override only to point
 * writes at a different bot on purpose.
 *
 * The default is the point. With reads remote and writes falling back to a local
 * checkout, every save would be judged by whatever code that checkout happened
 * to have checked out, with a write key the laptop should never hold, while the
 * screen showed production. Now reads and writes cannot name different bots
 * unless someone sets both URLs to say so.
 */
export const BOT_WRITE_API_BASE_URL =
  process.env.BOT_WRITE_API_BASE_URL?.trim() || BOT_API_BASE_URL;
/** The read token only follows the read URL: a token is never sent to a
 *  different host than the one it was issued for. */
export const BOT_WRITE_TOKEN =
  process.env.BOT_WRITE_TOKEN?.trim() ||
  (BOT_WRITE_API_BASE_URL === BOT_API_BASE_URL ? BOT_API_TOKEN : "");

/** Chosen the same way as BOT_SOURCE, so a write and a read cannot disagree
 *  about which genaebot they are talking to. */
export const WRITE_SOURCE: BotSource = BOT_WRITE_API_BASE_URL ? "remote" : "local";

/**
 * Writes are opt-in and off by default.
 *
 * Every request requires a verified Google session. Authentication does not
 * arm editing: the console and bot write gates must still agree.
 *
 * A target still has to be configured, so setting the flag alone cannot arm a
 * button that has nothing to call. And this is only the console's half: the
 * bot reports separately whether it holds a write key and which fields it will
 * accept (`overview.writes`, see `src/lib/write-capabilities`), and every control
 * gates on both.
 */
export const WRITES_ENABLED =
  process.env.CONSOLE_WRITES?.trim() === "1" &&
  (WRITE_SOURCE === "remote" ? Boolean(BOT_WRITE_TOKEN) : Boolean(GENAEBOT_CHECKOUT));

/** Account controls share the console's opt-in switch but require the live
 * gateway API rather than the canonical group/campaign writer. */
export const ACCOUNT_WRITES_ENABLED =
  process.env.CONSOLE_WRITES?.trim() === "1" && Boolean(BOT_API_BASE_URL && BOT_API_TOKEN);

/** The zone campaign sends are planned in, and the clock the console shows
 *  until an operator picks the other one (see `src/lib/timezone`). Changing
 *  which clock is on screen never moves a send: that is the bot's own setting. */
export const BOT_TIMEZONE = "Africa/Harare";

export const SESSION_COOKIE_NAME = "genaie_console_session";
/** Which clock this browser reads the console on. A preference, not operator
 *  state: it is held by the browser that chose it and never reaches the bot. */
export const TIMEZONE_COOKIE_NAME = "genaie_console_timezone";
export const TIMEZONE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
