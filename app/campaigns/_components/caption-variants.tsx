"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Section } from "@/app/_components/ui";
import { saveCaptionsAction } from "@/app/campaigns/actions";
import { captionEditorHref } from "@/src/lib/caption-editor";
import { plural } from "@/src/lib/format";

type Sample = { label: string; ref: string | null; caption: string | null } | null;
type Draft = { base: string[]; items: { id: number; text: string }[] };

export function CaptionVariants({
  slug, captions, samples, writable, saveUnavailableReason,
}: {
  slug: string;
  captions: string[];
  samples: Sample[];
  writable: boolean;
  saveUnavailableReason?: string;
}) {
  // A draft is independent of refreshed props, so polling cannot erase typing.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const items = draft?.items ?? captions.map((text, id) => ({ id, text }));
  const texts = items.map((item) => item.text);
  const dirty = JSON.stringify(texts) !== JSON.stringify(captions);
  const stale = draft !== null && JSON.stringify(draft.base) !== JSON.stringify(captions);
  const navigationBlocked = pending || dirty || stale;
  const valid = items.length > 0 && texts.every((text) => text.trim());

  function change(items: Draft["items"]) {
    setDraft({ base: draft?.base ?? captions, items });
    setError(null);
    setSaved(false);
  }

  function reset() {
    setDraft(null);
    setError(null);
    setSaved(false);
  }

  function save() {
    if (pending || !dirty || !valid || stale || saveUnavailableReason) return;
    startTransition(async () => {
      try {
        const outcome = await saveCaptionsAction(slug, texts, draft?.base ?? captions);
        if (!outcome.ok) {
          setError(outcome.detail);
          return;
        }
        setDraft(null);
        setSaved(true);
        setError(null);
      } catch {
        setError("Could not confirm the save. Your edits are still here; check the connection and try again.");
      }
    });
  }

  const removed = captions.length - items.length;
  // What the bar at the foot of the card says. Empty while there is nothing
  // to say, and then the bar folds away -- but the element stays mounted,
  // because a live region only announces a change it was already there for.
  const status = pending ? "Saving captions\u2026"
    : saved && !draft ? "Captions saved."
    : !dirty ? ""
    : !valid ? "Enter text for every variant before saving."
    : `${removed > 0 ? `${plural(removed, "variant")} removed, not saved yet.` : "Unsaved changes."} Save or reset before editing or adding a variant.`;
  const barActive = Boolean(draft) || saved;

  return (
    <Section id="caption-variants" className="caption-variants" flush busy={pending}
      title="Caption variants"
      description={writable
        ? "Each group is sent one of these. Open a variant to edit it by hand or with AI."
        : "Captions as sent, with each group\u2019s reference and link filled in. Editing is off in read-only mode."}
      actions={writable ? (
        navigationBlocked ? <button type="button" className="btn caption-add" disabled
          title="Save or reset pending deletions before adding a variant."><Plus size={16} aria-hidden /> Add variant</button>
          : <Link prefetch={false} className="btn caption-add" href={captionEditorHref(slug, "new")}><Plus size={16} aria-hidden /> Add variant</Link>
      ) : null}>
      <div className="card-pad grid caption-grid">
        {items.map((item, index) => {
          const sample = samples[item.id];
          const label = `Variant ${index + 1}`;
          return (
            <article className="caption-variant" key={item.id}>
              <div className="caption-variant-head">
                <span className="caption-variant-label" id={`caption-${item.id}-label`}>{label}</span>
                {writable ? (
                  <div className="caption-variant-actions">
                    {navigationBlocked ? <button type="button" className="btn btn-sm caption-edit" disabled
                      aria-label={`Edit variant ${index + 1}`} title="Save or reset pending deletions before editing a variant.">
                      <Pencil size={14} aria-hidden /> Edit
                    </button> : <Link prefetch={false} className="btn btn-sm caption-edit" aria-label={`Edit variant ${index + 1}`}
                      href={captionEditorHref(slug, index + 1)}><Pencil size={14} aria-hidden /> Edit</Link>}
                    <button type="button" className="row-action row-action-danger" aria-label={`Delete variant ${index + 1}`}
                      title={items.length === 1 ? "Keep at least one caption variant" : `Delete variant ${index + 1}`}
                      disabled={pending || items.length === 1}
                      onClick={() => change(items.filter((entry) => entry.id !== item.id))}>
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </div>
                ) : sample ? <span className="card-note">as sent to {sample.label} · {sample.ref}</span> : null}
              </div>
              <CaptionText labelledBy={`caption-${item.id}-label`}
                text={!dirty && !stale ? sample?.caption ?? item.text : item.text} />
              {!dirty && !stale && sample ? <p className="card-note">Posting preview for {sample.label}</p> : null}
              {writable && !dirty && !stale && sample ? (
                <details className="caption-preview">
                  <summary>Caption template · Posting preview for {sample.label} · {sample.ref}</summary>
                  <pre className="caption-box">{item.text}</pre>
                </details>
              ) : null}
            </article>
          );
        })}
        {items.length === 0 ? <p className="card-note">No caption variants yet. Add a variant to get started.</p> : null}
      </div>
      {writable ? (
        <div className={barActive ? `caption-variants-bar${saved && !draft ? " is-saved" : ""}` : "caption-variants-bar is-idle"}>
          <div className="caption-variants-bar-text">
            <p className="card-note" role="status">{status}</p>
            {error || stale ? <p className="caption-error" role="alert">{error ?? "Captions changed while you were editing. Reset to load the latest captions."}</p> : null}
            {draft && saveUnavailableReason ? <p className="card-note">{saveUnavailableReason}</p> : null}
          </div>
          {draft ? (
            <div className="caption-variants-bar-actions">
              <button type="button" className="btn" disabled={pending} onClick={reset}>Reset</button>
              <button type="button" className="btn btn-primary" onClick={save}
                title={saveUnavailableReason}
                disabled={pending || !dirty || !valid || stale || Boolean(saveUnavailableReason)}>
                {pending ? "Saving\u2026" : "Save changes"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}

/**
 * A caption as it will read, cut to about ten lines until asked for in full.
 *
 * Captions run to a thousand characters, and three of them at full length
 * push everything else on the screen out of sight. Whether a caption is long
 * enough to need cutting depends on the width it wraps at, so it is measured
 * rather than guessed from its length; without a layout (a test, a first
 * paint) nothing is cut and there is no toggle.
 */
export function CaptionText({ text, labelledBy }: { text: string; labelledBy: string }) {
  const box = useRef<HTMLPreElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const element = box.current;
    if (!element || open || typeof ResizeObserver === "undefined") return;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, text]);

  return (
    <div className={open ? "caption-clamp is-open" : overflows ? "caption-clamp is-cut" : "caption-clamp"}>
      <pre ref={box} className="caption-box" aria-labelledby={labelledBy}>{text}</pre>
      {overflows || open ? (
        <button type="button" className="caption-clamp-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show full caption"}
        </button>
      ) : null}
    </div>
  );
}
