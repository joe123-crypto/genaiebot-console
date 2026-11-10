"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { saveCaptionsAction } from "@/app/campaigns/actions";
import { captionEditorHref } from "@/src/lib/caption-editor";

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

  return (
    <section className="card caption-variants" aria-labelledby="caption-variants-title" aria-busy={pending}>
      <div className="card-head">
        <div>
          <h2 className="card-title" id="caption-variants-title">Caption variants</h2>
          <p className="card-note caption-help">
            {writable
              ? "Open a variant to edit manually or with AI. Group references and WhatsApp links are filled in when sent."
              : "Captions as sent, with each group’s reference and link filled in. Editing is off in read-only mode."}
          </p>
        </div>
        {writable ? (
          <div className="caption-actions">
            {navigationBlocked ? <button type="button" className="btn caption-add" disabled
              title="Save or reset pending deletions before adding a variant."><Plus size={16} aria-hidden /> Add variant</button>
              : <Link className="btn caption-add" href={captionEditorHref(slug, "new")}><Plus size={16} aria-hidden /> Add variant</Link>}
            {draft ? <button type="button" className="btn" disabled={pending} onClick={reset}>Reset</button> : null}
            <button type="button" className="btn btn-primary" onClick={save}
              title={saveUnavailableReason}
              disabled={pending || !dirty || !valid || stale || Boolean(saveUnavailableReason)}>
              {pending ? "Saving…" : "Save changes"}
            </button>
          </div>
        ) : null}
      </div>
      {writable ? (
        <div className="caption-feedback">
          {saveUnavailableReason ? <p className="card-note">{saveUnavailableReason}</p> : null}
          {error || stale ? <p className="caption-error" role="alert">{error ?? "Captions changed while you were editing. Reset to load the latest captions."}</p> : null}
          <p className="card-note" role="status">
            {pending ? "Saving captions…" : saved ? "Captions saved." : dirty
              ? valid ? "Unsaved changes" : "Enter text for every variant before saving."
              : "Changes apply to future posts after you save."}
          </p>
          {dirty ? <p className="card-note">Save or reset pending deletions before editing or adding a variant.</p> : null}
        </div>
      ) : null}
      <div className="card-pad grid caption-grid">
        {items.map((item, index) => {
          const sample = samples[item.id];
          return (
            <div className="caption-variant" key={item.id}>
              <div className="caption-variant-head">
                <span className="pill pill-info" id={`caption-${item.id}-label`}>Variant {index + 1}</span>
                {writable ? (
                  <div className="caption-variant-actions">
                  {navigationBlocked ? <button type="button" className="row-action" disabled
                    aria-label={`Edit variant ${index + 1}`} title="Save or reset pending deletions before editing a variant.">
                    <Pencil size={16} aria-hidden />
                  </button> : <Link className="row-action" aria-label={`Edit variant ${index + 1}`}
                    title={`Edit variant ${index + 1}`} href={captionEditorHref(slug, index + 1)}><Pencil size={16} aria-hidden /></Link>}
                  <button type="button" className="row-action row-action-danger" aria-label={`Delete variant ${index + 1}`}
                    title={items.length === 1 ? "Keep at least one caption variant" : `Delete variant ${index + 1}`}
                    disabled={pending || items.length === 1}
                    onClick={() => change(items.filter((entry) => entry.id !== item.id))}>
                    <Trash2 size={16} aria-hidden />
                  </button>
                  </div>
                ) : sample ? <span className="card-note">as sent to {sample.label} · {sample.ref}</span> : null}
              </div>
              <pre className="caption-box caption-card-text" aria-labelledby={`caption-${item.id}-label`}>
                {writable ? item.text : sample?.caption ?? item.text}
              </pre>
              {writable && !dirty && !stale && sample ? (
                <details className="caption-preview">
                  <summary>Preview for {sample.label} · {sample.ref}</summary>
                  <pre className="caption-box">{sample.caption ?? item.text}</pre>
                </details>
              ) : null}
            </div>
          );
        })}
        {items.length === 0 ? <p className="card-note">No caption variants yet. Add a variant to get started.</p> : null}
      </div>
    </section>
  );
}
