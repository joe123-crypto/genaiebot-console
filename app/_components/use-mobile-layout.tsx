"use client";
import { useEffect, useState } from "react";

/** The phone layout's width. Keep it in step with the @media (max-width: 760px)
 *  block at the end of globals.css, which is what actually lays the page out. */
export const MOBILE_LAYOUT_QUERY = "(max-width: 760px)";

/**
 * Whether the page itself is the scroller. On a phone the panes that scroll on
 * a desktop -- the day timeline, the campaign and group tables -- are laid out
 * at their full height and the document carries the scroll, so anything that
 * reads or drives one of those panes has to follow the window instead.
 *
 * Starts false so the server's markup and the first client render agree, and so
 * an environment with no matchMedia (jsdom) keeps the desktop behaviour.
 */
export function useMobileLayout() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const read = () => setMobile(query.matches);
    read();
    // Older jsdom MediaQueryList objects carry neither listener method.
    query.addEventListener?.("change", read);
    return () => query.removeEventListener?.("change", read);
  }, []);
  return mobile;
}
