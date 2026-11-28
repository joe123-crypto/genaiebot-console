"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

/** The panel is inline in the desktop layout and opens on demand once the
 *  layout is compact: the console menu on every page, the summary on Home. */
export function Disclosure({ className, label, children }: {
  className: string; label: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = panel.current;
    const container = element?.parentElement?.parentElement;
    if (!open || !element || !container) return;

    const measure = () => {
      const available = window.innerHeight - element.getBoundingClientRect().top - 12;
      element.style.setProperty("--disclosure-space", `${Math.max(0, available)}px`);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    // A banner or a change in the dashboard height can move the overlay's trigger.
    for (const sibling of container.children) observer?.observe(sibling);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      element.style.removeProperty("--disclosure-space");
    };
  }, [open]);

  return <div className={`disclosure ${className}`} data-open={open || undefined}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}
    onKeyDown={(event) => {
      if (event.key !== "Escape" || !open || !trigger.current?.getClientRects().length) return;
      event.stopPropagation();
      setOpen(false);
      trigger.current.focus({ preventScroll: true });
    }}>
    <button className="btn disclosure-toggle" type="button" ref={trigger}
      aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>{label}</button>
    <div className="disclosure-panel" id={panelId} ref={panel}
      tabIndex={open ? 0 : undefined} role={open ? "group" : undefined} aria-label={open ? label : undefined}>
      {children}
    </div>
  </div>;
}
