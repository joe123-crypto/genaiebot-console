import type { ReactNode } from "react";
import { CheckCheck } from "lucide-react";
import { PRODUCT_NAME } from "@/src/config";
import { ConsoleNav, type NavCounts } from "@/app/_components/console-nav";
import { AutoRefresh } from "@/app/_components/auto-refresh";

type Attention = { label: string; detail?: string };

/**
 * The console frame: a fixed sidebar carrying the brand, an attention card that
 * only appears when the bot needs something, the section nav, and the operator;
 * everything else renders to the right.
 */
export function ConsoleShell({
  children,
  counts,
  attention = [],
  operator,
}: {
  children: ReactNode;
  counts: NavCounts;
  attention?: Attention[];
  operator: { name: string; meta: string };
}) {
  const initial = operator.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="console-app">
      <aside className="console-sidebar">
        <div className="console-brand">
          <span className="console-brand-mark" aria-hidden>
            <CheckCheck size={19} strokeWidth={2.4} />
          </span>
          <span className="console-brand-name">{PRODUCT_NAME}</span>
        </div>

        {attention.length > 0 ? (
          <div className="attention-card">
            <span className="attention-title">
              <span className="attention-dot" aria-hidden />
              Needs attention
            </span>
            {attention.map((item) => (
              <span className="attention-item" key={item.label}>
                <span>{item.label}</span>
                {item.detail ? <strong>{item.detail}</strong> : null}
              </span>
            ))}
          </div>
        ) : null}

        <ConsoleNav counts={counts} />

        <div className="console-account">
          <span className="console-avatar" aria-hidden>{initial}</span>
          <span>
            <span className="console-account-name">{operator.name}</span>
            <br />
            <span className="console-account-meta">{operator.meta}</span>
            <AutoRefresh />
          </span>
        </div>
      </aside>

      <section className="console-content">{children}</section>
    </div>
  );
}
