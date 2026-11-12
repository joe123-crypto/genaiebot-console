"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, Eye, Pencil, RotateCcw, Save } from "lucide-react";
import { PageHead } from "@/app/_components/ui";
import { ConfirmDialog } from "@/app/_components/confirm-dialog";
import { SyncNotice } from "@/app/_components/live-page";
import { CaptionAssistant } from "@/app/campaigns/_components/caption-assistant";
import { saveCaptionsAction } from "@/app/campaigns/actions";
import { captionDraftKey, editedCaptions, parseCaptionDraft, type CaptionDraft } from "@/src/lib/caption-editor";
import { campaignTitle } from "@/src/lib/format";
import type { CaptionEditorDetail } from "@/src/domains/campaign-detail";

const UNAVAILABLE = "Saving is unavailable until the required campaign data refreshes successfully. Your draft is kept here.";

export function CaptionEditorScreen({ slug, variant, detail, writable, saveUnavailableReason, aiUnavailableReason, images }: {
  slug: string; variant: string; detail: CaptionEditorDetail; writable: boolean;
  saveUnavailableReason?: string; aiUnavailableReason?: string; images?: string[];
}) {
  // Retain successful reads across polling failures without leaving saves armed.
  const [lastPreview, setLastPreview] = useState(detail.preview.ok ? detail.preview : null);
  const [lastCampaign, setLastCampaign] = useState(detail.campaign.ok ? detail.campaign : null);
  if (detail.preview.ok && detail.preview !== lastPreview) setLastPreview(detail.preview);
  if (detail.campaign.ok && detail.campaign !== lastCampaign) setLastCampaign(detail.campaign);
  const preview = detail.preview.ok ? detail.preview : lastPreview;
  const campaign = detail.campaign.ok ? detail.campaign : lastCampaign;
  const fresh = detail.preview.ok && detail.campaign.ok && detail.writes.ok;
  const reason = !writable ? "Editing is off because the console is in read-only mode."
    : !fresh ? UNAVAILABLE : saveUnavailableReason;
  const router = useRouter();

  return <><SyncNotice sync={detail.sync} />
    {!detail.preview.ok || !detail.campaign.ok || !detail.writes.ok ? <div className="campaign-read-notice" role="status">
      <div><strong>Could not refresh caption editor.</strong> {preview && campaign ? "Showing the last loaded data. " : "Required campaign data is unavailable. "}
        {!detail.campaign.ok ? detail.campaign.error.detail : !detail.preview.ok ? detail.preview.error.detail : !detail.writes.ok ? detail.writes.error.detail : ""}</div>
      <button type="button" className="btn" onClick={() => router.refresh()}>Retry</button>
    </div> : null}
    {preview && campaign?.data ? <CaptionEditor key={`${slug}:${variant}`} slug={slug} variant={variant}
      name={campaign.data.source === "console" ? campaign.data.name : campaignTitle(slug)} captions={preview.data.captions}
      writable={writable} saveUnavailableReason={reason} aiUnavailableReason={aiUnavailableReason} images={images} />
      : <><PageHead title="Caption editor" subtitle="Load the campaign to edit its caption." />
        <section className="card card-pad"><p>Caption data is unavailable. Retry to load the editor.</p>
          <Link prefetch={false} className="link" href={`/campaigns/${encodeURIComponent(slug)}`}>Back to campaign</Link></section></>}
  </>;
}

/** The writing surface itself: text, its live preview, and the AI assistant.
 *  Undo and the assistant's revision guard are its own; remount it to reset. */
export function CaptionWorkspace({ name, variantLabel, text, disabled, autoFocus, aiUnavailableReason, images, onText }: {
  name: string; variantLabel: string; text: string; disabled: boolean; autoFocus?: boolean;
  aiUnavailableReason?: string; images?: string[]; onText: (text: string) => void;
}) {
  const [revision, setRevision] = useState(0);
  const [undo, setUndo] = useState<string | null>(null);

  function change(next: string) {
    onText(next);
    setRevision((previous) => previous + 1);
    setUndo(null);
  }

  return <>
    <div className="caption-editor-workspace">
      <section className="card caption-writing" aria-labelledby="caption-writing-title">
        <div className="card-head"><h2 className="card-title caption-section-title" id="caption-writing-title"><Pencil size={16} aria-hidden /> Your caption</h2>
          <span className="card-note">{Array.from(text).length.toLocaleString()} characters</span></div>
        <div className="card-pad">
          <label className="sr-only" htmlFor="caption-editor-text">Caption text</label>
          <textarea id="caption-editor-text" className="caption-editor-input" rows={15} value={text} disabled={disabled} autoFocus={autoFocus}
            placeholder="Write your caption here…" aria-describedby="caption-template-help" onChange={(event) => change(event.target.value)} />
          <div className="caption-template-help" id="caption-template-help">Keep template placeholders such as <code>{"{bot_number}"}</code> and <code>{"{ref_link}"}</code>.
            Group references and WhatsApp links are filled in when sent.</div>
          {undo !== null ? <button type="button" className="btn caption-undo" disabled={disabled} onClick={() => change(undo)}><RotateCcw size={14} aria-hidden /> Undo AI edit</button> : null}
        </div>
      </section>
      <section className="card caption-live-preview" aria-labelledby="caption-preview-title">
        <div className="card-head"><h2 className="card-title caption-section-title" id="caption-preview-title"><Eye size={17} aria-hidden /> Preview</h2>
          <span className="pill">Template</span></div>
        <div className="card-pad"><div className="caption-preview-paper">
          <span className="caption-preview-eyebrow">{name} · Variant {variantLabel}</span>
          <pre className={`caption-editor-preview${text ? "" : " is-empty"}`}>{text || "Your caption preview will appear here."}</pre>
        </div><p className="card-note caption-preview-note">Template preview. Each group’s reference and contact link are added when sent.</p></div>
      </section>
    </div>
    <CaptionAssistant text={text} revision={revision} disabled={disabled} unavailableReason={aiUnavailableReason} images={images}
      onApply={(suggestion, sourceRevision) => {
        if (disabled || sourceRevision !== revision) return;
        const previous = text;
        change(suggestion);
        setUndo(previous);
      }} />
  </>;
}

export function CaptionEditor({ slug, variant, name, captions, writable, saveUnavailableReason, aiUnavailableReason, images }: {
  slug: string; variant: string; name: string; captions: string[]; writable: boolean;
  saveUnavailableReason?: string; aiUnavailableReason?: string; images?: string[];
}) {
  const router = useRouter();
  const index = variant === "new" ? captions.length : Number(variant) - 1;
  const [draft, setDraft] = useState<CaptionDraft>(() => ({ version: 1, base: captions, text: variant === "new" ? "" : captions[index] ?? "" }));
  const [ready, setReady] = useState(false);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  // A draft kept from an earlier visit looks exactly like the saved caption,
  // and the assistant is handed whatever is on screen. Say which this is.
  const [fromEarlierVisit, setFromEarlierVisit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [resetCount, setResetCount] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [conflict, setConflict] = useState<{ received: string[]; latest: string[] } | null>(null);
  const finished = useRef(false);
  const submitting = useRef(false);
  const initialCaptions = useRef(captions);
  const key = captionDraftKey(slug, variant);
  const back = `/campaigns/${encodeURIComponent(slug)}`;
  const latestCaptions = conflict && JSON.stringify(conflict.received) === JSON.stringify(captions) ? conflict.latest : captions;
  const stale = JSON.stringify(draft.base) !== JSON.stringify(latestCaptions);
  const validVariant = variant === "new" || (index >= 0 && index < draft.base.length);
  const dirty = draft.text !== (variant === "new" ? "" : draft.base[index] ?? "");
  const locked = !ready || !writable || pending;
  const nextCaptions = editedCaptions(draft.base, variant, draft.text);
  const tooLarge = new TextEncoder().encode(JSON.stringify(nextCaptions)).byteLength > 60 * 1024;

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const restored = parseCaptionDraft(raw);
        // A confirmed save may already be visible after interrupted navigation.
        if (JSON.stringify(editedCaptions(restored.base, variant, restored.text)) !== JSON.stringify(initialCaptions.current)) {
          setDraft(restored);
          setFromEarlierVisit(true);
        }
        else sessionStorage.removeItem(key);
      }
    } catch {
      setStorageNotice("The saved draft could not be restored. Edits will be kept in this editor while it is open.");
    }
    setReady(true);
    // Restore once per mounted campaign/variant, never during polling.
  }, [key, variant]);

  useEffect(() => {
    if (!ready || finished.current) return;
    try {
      if (dirty || stale) sessionStorage.setItem(key, JSON.stringify(draft));
      else sessionStorage.removeItem(key);
    } catch { setStorageNotice("Browser storage is unavailable. Your draft is kept only while this editor is open."); }
  }, [draft, dirty, stale, ready, key]);

  function updateText(text: string) {
    setDraft((previous) => ({ ...previous, text }));
    setError(null);
  }

  function reset() {
    setDraft({ version: 1, base: latestCaptions, text: variant === "new" ? "" : latestCaptions[index] ?? "" });
    setFromEarlierVisit(false);
    setError(null);
    setResetCount((previous) => previous + 1);
  }

  function clearAndLeave() {
    try { sessionStorage.removeItem(key); } catch { /* In-memory draft is discarded on navigation. */ }
    finished.current = true;
    router.push(back);
    router.refresh();
  }

  function save() {
    if (locked || submitting.current || !dirty || !draft.text.trim() || stale || tooLarge || !validVariant || saveUnavailableReason) return;
    submitting.current = true;
    startTransition(async () => {
      try {
        const outcome = await saveCaptionsAction(slug, nextCaptions, draft.base);
        if (!outcome.ok) {
          if (outcome.latestCaptions) setConflict({ received: captions, latest: outcome.latestCaptions });
          setError(outcome.detail);
          return;
        }
        clearAndLeave();
      } catch {
        setError("Could not confirm the save. Your edits are still here; check the connection and try again.");
      } finally { submitting.current = false; }
    });
  }

  if (!ready) return <section className="card card-pad" role="status">Loading caption draft…</section>;
  if (!validVariant) return <section className="card card-pad"><h1 className="card-title">Caption variant unavailable</h1>
    <p>This variant does not exist in the loaded campaign. Return to the campaign to choose another.</p>
    <Link prefetch={false} className="link" href={back}>Back to campaign</Link></section>;

  return <div className="caption-editor-page" aria-busy={pending}>
    <Link prefetch={false} className="caption-back link" href={back}><ArrowLeft size={16} aria-hidden /> Back to campaign</Link>
    <PageHead title={variant === "new" ? "Create a caption" : `Edit caption · Variant ${variant}`} subtitle={name}
      actions={<div className="caption-actions">
        <button type="button" className="btn" disabled={pending} onClick={() => dirty ? setCancelOpen(true) : clearAndLeave()}>Cancel</button>
        <button type="button" className="btn btn-primary caption-save" onClick={save}
          disabled={locked || !dirty || !draft.text.trim() || stale || tooLarge || Boolean(saveUnavailableReason)}>
          <Save size={16} aria-hidden />{pending ? "Saving…" : "Save caption"}
        </button></div>} />
    <div className="caption-editor-feedback">
      {saveUnavailableReason ? <p className="card-note">{saveUnavailableReason}</p> : null}
      {error || stale ? <p className="caption-error" role="alert">{error ?? "Captions changed since this draft was started. Your draft is kept. Reset to latest before saving."}</p> : null}
      {storageNotice ? <p className="card-note" role="status">{storageNotice}</p> : null}
      {fromEarlierVisit ? <p className="caption-restored" role="status">
        This is an unsaved draft kept from an earlier visit, not the caption that is saved now. The assistant works from what is shown here.{" "}
        <button type="button" className="caption-reset link" disabled={locked} onClick={reset}>Load the saved caption</button>
      </p> : null}
      {tooLarge ? <p className="caption-error" role="alert">The captions are too large to save. Shorten them and try again.</p> : null}
      <span className="card-note" role="status">{pending ? "Saving caption…" : dirty ? "Unsaved changes · Changes apply to future posts after saving." : "Changes apply to future posts after saving."}</span>
      {dirty || stale ? <button type="button" className="caption-reset link" disabled={locked} onClick={reset}><RotateCcw size={14} aria-hidden /> Reset to latest</button> : null}
    </div>
    <CaptionWorkspace key={resetCount} name={name} variantLabel={variant === "new" ? String(draft.base.length + 1) : variant}
      text={draft.text} disabled={locked} autoFocus={variant === "new"} aiUnavailableReason={aiUnavailableReason} images={images} onText={updateText} />
    {cancelOpen ? <ConfirmDialog title="Discard this caption draft?" confirmLabel="Discard draft" danger
      onClose={() => setCancelOpen(false)} onConfirm={clearAndLeave}>
      <p>Your unsaved caption edits will be removed. The saved campaign caption will stay as it is.</p>
    </ConfirmDialog> : null}
  </div>;
}
