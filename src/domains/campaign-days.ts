import { ALL_WEEKDAYS, WEEKDAYS } from "@/src/domains/campaign-create";

/**
 * Per-assignment posting days: which weekdays a campaign posts to a group on.
 *
 * The console counts weekdays the way the create form does -- integers, Monday
 * is 0 -- while the bot stores day-name tokens in `groups/<jid>.weekly`. The
 * conversion lives here so the dialog, the server action and their tests all
 * read the same vocabulary, and so the one rule that is easy to get wrong --
 * all seven days is not a restriction, it is the absence of one -- is written
 * once.
 */
export { ALL_WEEKDAYS, WEEKDAYS };

/** Chosen days per campaign slug, as the dialog sends them. */
export type CampaignDays = Record<string, number[]>;

/** The bot's own spelling: `[0, 2, 4]` becomes `["Mon", "Wed", "Fri"]`. */
export function weekdayTokens(days: number[]) {
  return [...days].sort((left, right) => left - right).map((day) => WEEKDAYS[day]);
}

/** Every day chosen is daily, which the bot stores as no `weekly` entry at all. */
export function isEveryDay(days: number[]) {
  return new Set(days).size === ALL_WEEKDAYS.length;
}

/** The same check runs in the dialog and in the action; the bot checks again. */
export function campaignDaysProblem(value: unknown, slugs: string[]): string | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "The chosen days could not be read.";
  for (const [slug, days] of Object.entries(value as Record<string, unknown>)) {
    if (!slugs.includes(slug)) return "Days were chosen for a campaign that is not selected.";
    if (!Array.isArray(days) || days.length === 0 || days.length > ALL_WEEKDAYS.length ||
      new Set(days).size !== days.length ||
      days.some((day) => !Number.isInteger(day) || day < 0 || day > ALL_WEEKDAYS.length - 1)) {
      return "Choose at least one day for every campaign you restrict.";
    }
  }
}
