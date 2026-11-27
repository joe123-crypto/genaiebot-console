import Link from "next/link";

/**
 * What a page that needs the bot shows when the workspace has none: a user
 * who skipped onboarding. The page keeps its own heading, and this says what
 * it is waiting for and where the bot is made.
 */
export function NoBotYet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card card-pad empty">
      <h2 className="card-title">{title}</h2>
      <p>{children}</p>
      <div className="setup-actions">
        <Link prefetch={false} className="btn btn-primary" href="/setup">Create your bot</Link>
      </div>
    </section>
  );
}
