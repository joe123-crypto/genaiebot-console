import { botErrorMetadata, type BotErrorMetadata } from "@/src/lib/bot-error-metadata";

/**
 * The bot errors live apart from the bot client so the workspace resolver can
 * raise them too (a missing bot is a reason the bot cannot be read) without an
 * import cycle. `bot-client` re-exports both, so every existing import holds.
 */
export class BotUnavailableError extends Error {
  readonly detail: string;
  readonly status?: number;
  readonly metadata: BotErrorMetadata;
  constructor(detail: string, status?: number, metadata: BotErrorMetadata = {}) {
    super("Could not reach the bot's state.");
    this.name = "BotUnavailableError";
    this.detail = detail;
    this.status = status;
    this.metadata = botErrorMetadata(metadata);
  }
}

/**
 * The bot refused a config change and said why. Unlike "could not reach the
 * bot", the change definitely did not happen, and `problems` carries the bot's
 * own reasons -- for a group, the validator's words about what the change would
 * have broken. A subclass of BotUnavailableError so every existing catch still
 * shows `detail`; a screen that can show the reasons checks for this one.
 */
export class WriteRefusedError extends BotUnavailableError {
  readonly problems: string[];
  readonly status: number;
  constructor(detail: string, problems: string[], status: number, metadata: BotErrorMetadata = {}) {
    super(detail, status, metadata);
    this.name = "WriteRefusedError";
    this.problems = problems;
    this.status = status;
  }
}

