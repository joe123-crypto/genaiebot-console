"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { avatarInitial } from "@/src/lib/format";

/**
 * The operator chip at the foot of the sidebar, which is also the way to the
 * account page.
 *
 * A client component for one reason: only the browser knows which route is
 * showing, and the chip has to light up on its own page like every nav item
 * above it. The live-updates line that sits under it is a status region, so it
 * stays outside this link rather than being read out as part of the link's
 * name.
 */
export function AccountLink({ name, meta }: { name: string; meta: string }) {
  const pathname = usePathname() || "/";
  return (
    <Link
      prefetch={false}
      href="/account"
      className="console-account-link"
      aria-current={pathname.startsWith("/account") ? "page" : undefined}
    >
      <span className="console-avatar" aria-hidden>{avatarInitial(name)}</span>
      <span className="console-account-identity">
        <span className="console-account-name">{name}</span>
        <span className="console-account-meta">{meta}</span>
      </span>
    </Link>
  );
}
