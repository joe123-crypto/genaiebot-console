import { BotUnavailableError, WriteRefusedError, WritesDisabledError } from "@/src/lib/bot-client";

/**
 * What a server action hands back after a config write. A value, not a thrown
 * error: the row or dialog that raised it is the right place to say so, and
 * throwing would replace the whole screen with an error page.
 *
 * `problems` are the bot's own reasons when it refused -- the validator's lines,
 * which say which field broke what. They are absent when the outcome is merely
 * unknown or the bot could not be reached.
 *
 * `warnings` are for the other shape: the change landed, and something asked
 * for alongside it did not. A delete that removed the record but could not take
 * the bot out of the WhatsApp group succeeded and must still say so, because
 * the row is about to disappear and take the chance to say it with it.
 */
export type WriteOutcome =
  | { ok: true; warnings?: string[] }
  | { ok: false; detail: string; problems?: string[] };

export const READ_ONLY_OUTCOME: WriteOutcome = {
  ok: false, detail: "The console is in read-only mode.",
};

/** The failures an operator should see, as an outcome. Anything else is a bug
 *  and is rethrown so it surfaces as one. */
export function failedWrite(error: unknown): WriteOutcome {
  if (error instanceof WriteRefusedError) {
    return { ok: false, detail: error.detail, problems: error.problems };
  }
  if (error instanceof BotUnavailableError || error instanceof WritesDisabledError) {
    return { ok: false, detail: error.detail };
  }
  throw error;
}
