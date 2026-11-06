"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { saveCaptionsAction } from "@/app/campaigns/actions";

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
  const nextId = useRef(captions.length);
  const items = draft?.items ?? captions.map((text, id) => ({ id, text }));
  const texts = items.map((item) => item.text);
  const dirty = JSON.stringify(texts) !== JSON.stringify(captions);
  const stale = draft !== null && JSON.stringify(draft.base) !== JSON.stringify(captions);
  const valid = items.length > 0 && texts.every((text) => text.trim());

  function change(items: Draft["items"]) {
    setDraft({ base: draft?.base ?? captions, items });
    setError(null);
    setSaved(false);
  }

  function reset() {
    setDraft(null);
    nextId.current = captions.length;
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
              ? "Edit the captions below. Group references and WhatsApp links are filled in when sent."
              : "Captions as sent, with each group’s reference and link filled in. Editing is off in read-only mode."}
          </p>
        </div>
        {writable ? (
          <div className="caption-actions">
            <button type="button" className="btn caption-add" disabled={pending}
              onClick={() => {
                const id = Math.max(nextId.current, ...items.map((item) => item.id + 1));
                nextId.current = id + 1;
                change([...items, { id, text: "" }]);
              }}>
              <Plus size={16} aria-hidden /> Add variant
            </button>
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
        </div>
      ) : null}
      <div className="card-pad grid caption-grid">
        {items.map((item, index) => {
          const sample = samples[index];
          return (
            <div className="caption-variant" key={item.id}>
              <div className="caption-variant-head">
                <label className="pill pill-info" htmlFor={writable ? `caption-${item.id}` : undefined}>Variant {index + 1}</label>
                {writable ? (
                  <button type="button" className="row-action row-action-danger" aria-label={`Delete variant ${index + 1}`}
                    title={items.length === 1 ? "Keep at least one caption variant" : `Delete variant ${index + 1}`}
                    disabled={pending || items.length === 1}
                    onClick={() => change(items.filter((entry) => entry.id !== item.id))}>
                    <Trash2 size={16} aria-hidden />
                  </button>
                ) : sample ? <span className="card-note">as sent to {sample.label} · {sample.ref}</span> : null}
              </div>
              {writable ? (
                <textarea id={`caption-${item.id}`} className="caption-box caption-input" value={item.text}
                  rows={14} disabled={pending} autoFocus={item.text === "" && item.id >= captions.length}
                  placeholder="Write a caption…" onChange={(event) => change(items.map((entry) =>
                    entry.id === item.id ? { ...entry, text: event.target.value } : entry))} />
              ) : <pre className="caption-box">{sample?.caption ?? item.text}</pre>}
              {writable && !dirty && sample ? (
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
