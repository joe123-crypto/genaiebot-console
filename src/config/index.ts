/**
 * The console never holds its own copy of operator state. Each signed-in user
 * has a workspace, and each workspace has its own bot: the console reaches it
 * at the URL its registry entry names (`src/lib/workspace`). Nothing here names
 * a bot, so there is no default for a request to fall back to.
 */

export const PRODUCT_NAME = "Genaie";

/** Where the bot's own tooling lives when we read it locally. */
export const GENAEBOT_CHECKOUT =
  process.env.GENAEBOT_CHECKOUT?.trim() || "/home/joseph/projects/genaebot";

export type BotSource = "local" | "remote";

/**
 * `remote` everywhere except an explicit `BOT_SOURCE=local` in development,
 * which runs the bridges from GENAEBOT_CHECKOUT for the signed-in user's
 * workspace. Production never shells out, whatever the variable says.
 */
export const BOT_SOURCE: BotSource =
  process.env.BOT_SOURCE?.trim() === "local" && process.env.NODE_ENV !== "production" ? "local" : "remote";

export type ProvisionSource = "stub" | "none";

/**
 * Whether `/setup` can create a workspace's bot itself.
 *
 * `none` everywhere except an explicit `BOT_PROVISIONING=stub` in development,
 * which walks the creation screen through its stages without building anything.
 * Production is never anything but `none`: until a real provisioner exists, a
 * bot is still created by hand (`docs/provision-bot.md`), and a screen that
 * claimed otherwise would be lying to the one user who cannot check.
 */
export const BOT_PROVISIONING: ProvisionSource =
  process.env.BOT_PROVISIONING?.trim() === "stub" && process.env.NODE_ENV !== "production" ? "stub" : "none";

/**
 * Development only: a bot origin the stub's last stage really connects to, so
 * the finished run leaves a working console rather than a simulated one. Unset,
 * the stub writes nothing and the screen says the run was simulated.
 */
export const BOT_PROVISIONING_STUB_URL = process.env.BOT_PROVISIONING_STUB_URL?.trim() || "";

/** Reads and writes always reach the same bot: the workspace's own. */
export const WRITE_SOURCE: BotSource = BOT_SOURCE;

/**
 * Writes are opt-in and off by default.
 *
 * Every request requires a verified Google session. Authentication does not
 * arm editing: the console and bot write gates must still agree. Whether the
 * user's workspace has a bot to write to is checked per request.
 *
 * This is only the console's half: the bot reports separately whether it
 * holds a write key and which fields it will accept (`overview.writes`, see
 * `src/lib/write-capabilities`), and every control gates on both.
 */
export const WRITES_ENABLED = process.env.CONSOLE_WRITES?.trim() === "1";

/** Account controls share the console's opt-in switch but require the live
 * gateway API rather than the canonical group/campaign writer. */
export const ACCOUNT_WRITES_ENABLED = WRITES_ENABLED && BOT_SOURCE === "remote";

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
