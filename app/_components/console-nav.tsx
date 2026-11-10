"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  CalendarClock,
  Megaphone,
  MessageCircle,
  ScrollText,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavCounts = { groupsNeedingReview?: number; campaigns?: number };

const items: ReadonlyArray<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/", label: "Schedule", icon: CalendarClock },
  { href: "/groups", label: "Groups", icon: Users },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/lines", label: "WhatsApp Lines", icon: MessageCircle },
  { href: "/activity", label: "Activity", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal },
];

export function ConsoleNav({ counts }: { counts: NavCounts }) {
  const pathname = usePathname() || "/";

  return (
    <nav className="console-nav" aria-label="Console sections">
      {items.map(({ href, label, icon: Icon }) => {
        // Only "/" is matched exactly; every other section also owns its subpaths.
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        const count =
          href === "/groups"
            ? counts.groupsNeedingReview
            : href === "/campaigns"
              ? counts.campaigns
              : undefined;

        return (
          <Link prefetch={false}
            key={href}
            href={href}
            className="console-nav-item"
            aria-current={active ? "page" : undefined}
          >
            <Icon size={17} strokeWidth={2} aria-hidden />
            <span>{label}</span>
            {count ? <span className="console-nav-count">{count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
