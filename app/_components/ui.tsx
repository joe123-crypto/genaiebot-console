import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import type { GroupStatus } from "@/src/lib/types";

export function PageHead({
  title,
  subtitle,
  actions,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        {title ? <h1 className="page-title">{title}</h1> : null}
        {subtitle ? <p className="page-sub">{subtitle}</p> : null}
      </div>
      {actions}
    </header>
  );
}

export function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: string;
}) {
  return (
    <div className="card card-pad">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note ? <div className="stat-note">{note}</div> : null}
    </div>
  );
}

const STATUS_TONE: Record<GroupStatus, string> = {
  active: "pill-success",
  "on-hold": "pill-warning",
  "admin-only": "pill-danger",
  "not-a-member": "pill",
};

/** Exported so the Groups filter offers exactly the statuses the pills show. */
export const STATUS_LABEL: Record<GroupStatus, string> = {
  active: "Active",
  "on-hold": "On hold",
  "admin-only": "Admins only",
  "not-a-member": "Not a member",
};

export function StatusPill({ status }: { status: GroupStatus }) {
  return <span className={`pill ${STATUS_TONE[status] ?? ""}`}>{STATUS_LABEL[status] ?? status}</span>;
}

/** Shown instead of a screen's content when the bot's state is unreachable. */
export function BotError({ detail }: { detail: string }) {
  return (
    <div className="banner">
      <AlertTriangle size={17} aria-hidden style={{ flex: "0 0 auto", marginTop: 1 }} />
      <span>
        <strong>Could not read the bot&apos;s state.</strong> The console shows live data from
        genaebot and has no copy of its own, so there is nothing to fall back to.
        <pre>{detail}</pre>
      </span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
