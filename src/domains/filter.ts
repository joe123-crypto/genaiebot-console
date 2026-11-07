/**
 * The parts of a filtered table that have nothing to do with what is being
 * filtered: reading a query parameter, writing the non-default ones back, and
 * building a facet's options.
 *
 * Both list screens keep their view in the URL, and the rules for that are
 * fiddly enough to be worth stating once — a default must leave no trace, a
 * repeated parameter has to collapse to one value, and the order options come
 * out in has to be identical on the server and in the browser or the first
 * render mismatches. `group-filter` and `campaign-filter` supply the meaning;
 * this supplies the mechanics.
 *
 * Pure, and free of the bot adapters, because both tables are client
 * components. See the header of `@/src/domains/schedule` for why that matters.
 */

/** A filter is a flat record of strings, so a URL can hold all of it. */
export type FilterShape = Record<string, string>;

/** Accepts either shape a filter arrives in: a Next `searchParams` object on
 *  the server, or the live `URLSearchParams` in the browser. */
export function readParam(
  params: Record<string, string | string[] | undefined> | URLSearchParams,
  key: string,
): string {
  if (params instanceof URLSearchParams) return params.get(key) ?? "";
  const value = params[key];
  // `?status=a&status=b` arrives as an array; one control, so take the first.
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/** Only what differs from the default, so an unfiltered table has a clean URL
 *  to share and a cleared filter leaves no query string behind at all. */
export function queryFromFilter<T extends FilterShape>(
  filter: T,
  defaults: T,
  keys: readonly (keyof T & string)[],
): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of keys) {
    if (filter[key] !== defaults[key]) params.set(key, filter[key]);
  }
  return params;
}

export function isDefault<T extends FilterShape>(
  filter: T,
  defaults: T,
  keys: readonly (keyof T & string)[],
): boolean {
  return keys.every((key) => filter[key] === defaults[key]);
}

/** Codepoint order rather than `localeCompare`, which has no fixed collation
 *  and can order the same two strings differently in Node and the browser —
 *  which would show up as a hydration mismatch in a facet's option list. */
export function byValue(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export type FacetOption = { value: string; label: string; stale?: boolean };

/**
 * Keep a selection the data no longer contains.
 *
 * A line is renamed, a campaign retired, the last matching row deleted — and a
 * `<select>` with no option for its value displays the *first* option instead,
 * while the table goes on filtering by what the URL actually said. The control
 * would be quietly lying, so the vanished value stays in the list and says so.
 */
export function withSelection(
  options: FacetOption[],
  selected: string,
  label: (value: string) => string,
): FacetOption[] {
  if (!selected || options.some((option) => option.value === selected)) return options;
  return [...options, { value: selected, label: label(selected), stale: true }];
}

/** The union of some string drawn off every row, ready to be offered as a
 *  facet: blanks dropped, deduplicated, and ordered the same way everywhere. */
export function facetValues(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))].sort(byValue);
}
