import type { ReactNode } from "react";

/**
 * One band of the Settings page: what it is about on the left, held in place
 * while its cards scroll by on the right. The explanation lives here once, so
 * the cards beside it can be nothing but rows of controls.
 */
export function SettingsGroup({ id, title, description, children }: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-group" id={id} aria-labelledby={`${id}-title`}>
      <header className="settings-group-head">
        <h2 className="settings-group-title" id={`${id}-title`}>{title}</h2>
        {description ? <p className="settings-group-description">{description}</p> : null}
      </header>
      <div className="settings-group-body">{children}</div>
    </section>
  );
}
