"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { plural } from "@/src/lib/format";
import type { FacetOption } from "@/src/domains/filter";

/**
 * The filter bar both list screens wear, and the one piece of behaviour behind
 * it that is easy to get subtly wrong.
 *
 * What a bar narrows is the screen's business; holding the filter and keeping
 * it in step with the URL is not, and two copies of this would be two copies
 * of a debounce, a foreign-parameter rule, a no-op guard and the rule below
 * about which incoming filters to believe — free to drift apart.
 */

/** Long enough that a fast typist writes one history entry rather than twenty:
 *  Safari and Firefox throttle `replaceState` at around a hundred calls per
 *  thirty seconds. No table waits for this — they all filter from state as the
 *  key goes down. */
const URL_SYNC_MS = 250;

/**
 * Hold a table's filter, and keep it and the query string in step.
 *
 * The filter lives here rather than in the URL: typing narrows the table from
 * state, and the URL is caught up with a moment later, so a keystroke never
 * waits on the router. The server still parses the query string and hands it
 * back as `initialFilter` on every render, which leaves one question — when is
 * an incoming filter news, and when is it this table's own URL echoed back?
 *
 * Two things arrive looking identical:
 *
 *  - a **navigation**, such as a Needs attention link to `?status=admin-only`
 *    clicked while already on the page. Next re-renders this very component
 *    rather than remounting it, so seeding state once would leave the table
 *    showing the old filter while the URL claimed the new one;
 *  - the **sixty-second refresh**, which re-renders with whatever is in the
 *    URL — which may be a query this table wrote itself, and may be a debounce
 *    behind what is actually typed.
 *
 * So a filter is adopted only when it is both new since the last render *and*
 * not the query this table last wrote. Anything this table put in the URL is
 * its own echo and is ignored, which is what stops a refresh landing between a
 * keystroke and the debounce from snapping a half-typed search back.
 */
export function useUrlFilter<T extends Record<string, string>>(
  initialFilter: T,
  toQuery: (filter: T) => URLSearchParams,
  keys: readonly string[],
): [T, (update: (current: T) => T) => void] {
  const queryOf = (filter: T) => toQuery(filter).toString();

  const [filter, setFilter] = useState(initialFilter);
  const [seen, setSeen] = useState(() => queryOf(initialFilter));
  // The query string this table last put in the URL itself. Written only from
  // the effect below, so reading it while rendering is safe.
  const written = useRef(queryOf(initialFilter));

  const incoming = queryOf(initialFilter);
  if (incoming !== seen) {
    // Adjusting state while rendering: React re-runs this component at once,
    // before the browser paints, so the table never shows the stale filter.
    setSeen(incoming);
    if (incoming !== written.current) setFilter(initialFilter);
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      // Start from the live query string, so a parameter this table knows
      // nothing about survives being filtered.
      const next = new URLSearchParams(window.location.search);
      for (const key of keys) next.delete(key);
      for (const [key, value] of toQuery(filter)) next.set(key, value);
      const query = next.toString();
      const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
      // Recorded whether or not it is written, so the echo of a URL that was
      // already correct is recognised too.
      written.current = toQuery(filter).toString();
      // Next patches replaceState, so this updates the URL without refetching
      // the page. The guard keeps a no-op render from writing history at all.
      if (url !== `${window.location.pathname}${window.location.search}`) {
        window.history.replaceState(null, "", url);
      }
    }, URL_SYNC_MS);
    return () => clearTimeout(timer);
    // `toQuery` and `keys` are module-level constants at every call site, so
    // their identities are stable and only a changed filter reruns this.
  }, [filter, toQuery, keys]);

  return [filter, setFilter];
}

export function FilterBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="filter-bar" role="search" aria-label={label}>
      {children}
    </div>
  );
}

export function FilterField({
  id,
  label,
  className,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`filter-field${className ? ` ${className}` : ""}`}>
      <label className="filter-label" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

/** A search box with a real visible label, which is also what makes it
 *  reachable as a searchbox role rather than by placeholder text. */
export function FilterSearch({
  id,
  label,
  value,
  onChange,
  inputRef,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
  placeholder?: string;
}) {
  return (
    <FilterField id={id} label={label} className="filter-field-search">
      <input
        ref={inputRef}
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </FilterField>
  );
}

/** A select over values drawn from the rows. Disabled when there is nothing to
 *  choose, so it is never a control that does nothing. */
export function Facet({
  id,
  label,
  value,
  options,
  onChange,
  allLabel = "All",
}: {
  id: string;
  label: string;
  value: string;
  options: FacetOption[];
  onChange: (value: string) => void;
  allLabel?: string;
}) {
  return (
    <FilterField id={id} label={label}>
      <select
        id={id}
        value={value}
        disabled={options.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FilterField>
  );
}

export function FilterActions({ children }: { children: ReactNode }) {
  return <div className="filter-actions">{children}</div>;
}

/** How much of the record is on screen. `aria-atomic` so the number is not
 *  announced a digit at a time as it changes. */
export function FilterSummary({
  shown,
  total,
  noun,
  unfiltered,
  children,
}: {
  shown: number;
  total: number;
  noun: string;
  unfiltered: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="filter-summary">
      <p className="card-note" role="status" aria-atomic="true">
        {unfiltered
          ? `Showing all ${plural(total, noun)}`
          : `Showing ${shown} of ${plural(total, noun)}`}
      </p>
      {children}
    </div>
  );
}
