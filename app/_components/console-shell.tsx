import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { PRODUCT_NAME } from "@/src/config";
// Type-only, so this drags none of that module's bot adapters in.
import type { Attention } from "@/src/domains/console";
import { ConsoleNav, type NavCounts } from "@/app/_components/console-nav";
import { AutoRefresh } from "@/app/_components/auto-refresh";
import { Disclosure } from "@/app/_components/disclosure";
import { SignOut } from "./sign-out";
import { AccountLink } from "./account-link";

/**
 * The console frame: a fixed sidebar carrying the brand, an attention card that
 * only appears when the bot needs something, the section nav, and the operator;
 * everything else renders to the right. Narrow or short, the sidebar becomes a
 * bar across the top and the nav waits behind its Menu button.
 */
export function ConsoleShell({
  children,
  counts,
  attention = [],
  operator,
  homeLayout,
  campaignsLayout,
  groupsLayout,
}: {
  children: ReactNode;
  counts: NavCounts;
  attention?: Attention[];
  operator: { name: string; meta: string };
  homeLayout?: boolean;
  campaignsLayout?: boolean;
  groupsLayout?: boolean;
}) {
  const navigation = <>
    <ConsoleNav counts={counts} />
    <div className="console-account">
      <AccountLink name={operator.name} meta={operator.meta} />
      <AutoRefresh />
    </div>
    <SignOut />
  </>;

  return (
    <div className={groupsLayout ? "console-app console-app-home console-app-groups" : homeLayout ? "console-app console-app-home" : campaignsLayout ? "console-app console-app-campaigns" : "console-app"}>
      <aside className="console-sidebar">
        <div className="console-brand">
          <Image
            className="console-brand-mark"
            src="/logo.png"
            alt=""
            width={95}
            height={216}
            priority
          />
          <span className="console-brand-name">{PRODUCT_NAME}</span>
        </div>

        {attention.length > 0 ? (
          <div className="attention-card">
            <span className="attention-title">
              <span className="attention-dot" aria-hidden />
              Needs attention
            </span>
            {attention.map((item) => {
              const body = (
                <>
                  <span>{item.label}</span>
                  {item.detail ? <strong>{item.detail}</strong> : null}
                </>
              );
              // An item with a view that isolates it becomes the way to reach
              // it; one with nowhere to go stays the text it always was.
              return item.href ? (
                <Link prefetch={false} className="attention-item attention-link" key={item.label} href={item.href}>
                  {body}
                </Link>
              ) : (
                <span className="attention-item" key={item.label}>
                  {body}
                </span>
              );
            })}
          </div>
        ) : null}

        {/* Every page collapses to the same bar once the layout is compact; wider
            than that the disclosure is display: contents and this is the sidebar. */}
        <Disclosure className="console-menu" label="Menu">{navigation}</Disclosure>
      </aside>

      <section className="console-content">{children}</section>
    </div>
  );
}
