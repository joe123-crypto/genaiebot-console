import type { ReactNode, Ref } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import type { GroupStatus } from "@/src/lib/types";

/**
 * A screen's own heading.
 *
 * A screen about one thing -- a campaign, a caption, the customer bot -- also
 * says where it was reached from (`back`) and what state the thing is in
 * (`status`, a pill beside the title), and its actions wrap under the title
 * on a narrow window instead of squeezing it. That is opt-in: the list
 * screens tune their heads inside the clipped Home, Campaigns and Groups
 * shells, and are left exactly as they were.
 *
 * The back link is inside the header rather than above it so the sky wash
 * behind the header runs under it too.
 */
export function PageHead({
  title,
  subtitle,
  actions,
  back,
  status,
}: {
  title?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  status?: ReactNode;
}) {
  const detail = Boolean(back || status);
  return (
    <header className={detail ? "page-head page-head-detail" : "page-head"}>
      {back ? (
        <div className="page-back-row">
          <Link prefetch={false} className="page-back link" href={back.href}>
            <ArrowLeft size={15} aria-hidden /> {back.label}
          </Link>
        </div>
      ) : null}
      <div className="page-heading">
        {title || status ? (
          <div className="page-title-row">
            {title ? <h1 className="page-title">{title}</h1> : null}
            {status}
          </div>
        ) : null}
        {subtitle ? <p className="page-sub">{subtitle}</p> : null}
      </div>
      {detail && actions ? <div className="page-actions">{actions}</div> : actions}
    </header>
  );
}

/**
 * One card shape for the whole console.
 *
 * A block used to be either `.card .card-pad` with its heading inside the
 * padding, or `.card` with a ruled `.card-head` above it, chosen per
 * component -- so two cards on the same screen rarely agreed on where their
 * title sat. The ruled head is the shape that survives: it separates what
 * this is from what is in it, which is most of what hierarchy is.
 *
 * `id` is passed rather than generated because the title's id is also what
 * names the region to a screen reader, and this file is imported by server
 * components, where a hook cannot run. A section with neither a title nor an
 * aria-label is not a region at all, so the id is what makes it findable.
 */
export function Section({
  id, title, description, actions, footer, flush, busy, className, titleRef, children,
}: {
  id?: string;
  /** A node, not a string: a field's own <label> lives in its card's title. */
  title?: ReactNode;
  /** The sentence about the title. It sits with it, never in its own strip. */
  description?: ReactNode;
  actions?: ReactNode;
  /** Status, counts, and the reasons a control above is off. */
  footer?: ReactNode;
  /** The body brings its own edges: a table, a grid of tiles, a scroller. */
  flush?: boolean;
  busy?: boolean;
  className?: string;
  /** Review screens move focus to the heading they have just revealed. */
  titleRef?: Ref<HTMLHeadingElement>;
  children?: ReactNode;
}) {
  const titleId = id && title ? `${id}-title` : undefined;
  return (
    <section className={className ? `card section ${className}` : "card section"}
      aria-labelledby={titleId} aria-busy={busy || undefined}>
      {title || description || actions ? (
        <div className="card-head section-head">
          <div className="section-heading">
            {title ? <h2 className="card-title" id={titleId} ref={titleRef}
              tabIndex={titleRef ? -1 : undefined}>{title}</h2> : null}
            {description ? <p className="card-note section-description">{description}</p> : null}
          </div>
          {actions ? <div className="section-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children ? <div className={flush ? "section-body is-flush" : "section-body"}>{children}</div> : null}
      {footer ? <div className="section-foot">{footer}</div> : null}
    </section>
  );
}

export function Stat({
  label,
  value,
  note,
  plain,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  /** Inside a Section, where the card chrome is already the Section's own. */
  plain?: boolean;
}) {
  return (
    <div className={plain ? "stat" : "stat card card-pad"}>
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
