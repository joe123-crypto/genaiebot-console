"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHead } from "@/app/_components/ui";
import { CaptionWorkspace } from "@/app/campaigns/_components/caption-editor";
import { createCampaignAction } from "@/app/campaigns/new/actions";
import { campaignCreateError, type CampaignDraft, type NewCampaign } from "@/src/domains/campaign-create";
import { CAMPAIGN_CAPTIONS_KEY, CAMPAIGN_DRAFT_KEY, parseCampaignCaptions, parseCampaignDraft } from "@/src/lib/campaign-draft";
import { draftFiles, forgetDraftFiles } from "@/src/lib/campaign-files";
import { picturesForAI } from "@/src/lib/caption-pictures";
import { MAX_CAPTION_IMAGES } from "@/src/lib/caption-ai-limits";
import type { WriteGate } from "@/src/lib/write-capabilities";

type Variant = { id: number; text: string };
const DETAILS = "/campaigns/new";

export function CampaignCaptionStep({ gate, loadError, aiUnavailableReason }: {
  gate: WriteGate; loadError?: string; aiUnavailableReason?: string;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  // The page opens in the editor: writing the first caption is the point of it.
  const [editing, setEditing] = useState<{ id: number | "new"; text: string } | null>({ id: "new", text: "" });
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  // The pictures are not uploaded yet, so the assistant sees downscaled copies.
  const [pictures, setPictures] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [recovery, setRecovery] = useState<NewCampaign | null>(null);
  const [saved, setSaved] = useState<{ slug: string; warning: string } | null>(null);
  const nextId = useRef(0);
  const inFlight = useRef(false);
  const uploaded = useRef(new Set<string>());

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CAMPAIGN_DRAFT_KEY);
      if (raw) setDraft(parseCampaignDraft(raw).draft);
      const captions = sessionStorage.getItem(CAMPAIGN_CAPTIONS_KEY);
      const restored = captions ? parseCampaignCaptions(captions) : [];
      if (restored.length) {
        setVariants(restored.map((text) => ({ id: nextId.current++, text })));
        setEditing(null);
      }
    } catch {
      setStorageNotice("A kept caption draft could not be restored. Write the captions again before creating.");
    }
    setReady(true);
    // Restore once; nothing here polls.
  }, []);

  useEffect(() => {
    if (!draft) return;
    let live = true;
    void draftFiles()
      .then((files) => picturesForAI(draft.images.flatMap((image) => {
        const file = files.get(image.key);
        return file ? [file] : [];
      }), MAX_CAPTION_IMAGES))
      .then((shrunk) => { if (live) setPictures(shrunk); },
        // Without them the assistant simply has no pictures to look at.
        () => undefined);
    return () => { live = false; };
  }, [draft]);

  useEffect(() => {
    if (!ready || saved) return;
    try {
      if (variants.length) sessionStorage.setItem(CAMPAIGN_CAPTIONS_KEY, JSON.stringify({ version: 1, captions: variants.map((item) => item.text) }));
      else sessionStorage.removeItem(CAMPAIGN_CAPTIONS_KEY);
    } catch { setStorageNotice("Browser storage is unavailable. Your captions are kept only while this page is open."); }
  }, [variants, ready, saved]);

  function keep() {
    if (!editing || !editing.text.trim()) return;
    const text = editing.text.trim();
    setVariants((current) => editing.id === "new"
      ? [...current, { id: nextId.current++, text }]
      : current.map((item) => item.id === editing.id ? { ...item, text } : item));
    setEditing(null);
    setError("");
  }

  async function create() {
    if (inFlight.current || !gate.allowed || saved || editing || !variants.length) return;
    inFlight.current = true; setBusy(true); setError("");
    const request: NewCampaign = recovery ?? { ...draft!, captions: variants.map((item) => item.text) };
    let sent = false;
    try {
      const invalid = campaignCreateError(request);
      if (invalid && !recovery) { setError(invalid); return; }
      if (!recovery) {
        // The pictures were only ever held locally; they go up with the campaign.
        const files = await draftFiles();
        for (const [index, image] of request.images.entries()) {
          if (uploaded.current.has(image.key)) continue;
          const file = files.get(image.key);
          if (!file) throw new Error("The chosen pictures are no longer held. Go back to the campaign details and add them again.");
          setProgress(`Uploading picture ${index + 1} of ${request.images.length}…`);
          const signed = await fetch("/api/campaigns/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: request.slug, image }) });
          const upload = await signed.json();
          if (!signed.ok) throw new Error(upload.error || "The upload could not be prepared.");
          const response = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: file });
          // Immutable keys: a previous identical upload is verified by the bot.
          if (!response.ok && response.status !== 412) throw new Error(`Picture ${index + 1} could not upload. Your captions are kept; try again.`);
          uploaded.current.add(image.key);
        }
      }
      setProgress("Saving campaign and schedule…");
      sent = true;
      const result = await createCampaignAction(request);
      if (!result.ok) {
        // Once any attempt is uncertain, even a later preflight refusal cannot
        // prove that the earlier attempt did not land. Keep recovering it.
        if (recovery || result.outcome !== "not-created") setRecovery(request);
        setError(result.detail);
        return;
      }
      setRecovery(null);
      try { sessionStorage.removeItem(CAMPAIGN_DRAFT_KEY); sessionStorage.removeItem(CAMPAIGN_CAPTIONS_KEY); } catch { /* The drafts leave with the tab. */ }
      void forgetDraftFiles();
      if (result.scheduling === "pending") {
        setSaved({ slug: result.slug, warning: result.warning || "Campaign saved. Scheduling is pending; the bot will retry automatically." });
      } else {
        setSaved({ slug: result.slug, warning: "Campaign saved." });
        router.push(`/campaigns/${result.slug}`); router.refresh();
      }
    } catch (failure) {
      // An upload that never reached the create API cannot have created anything.
      if (sent) setRecovery(request);
      setError(failure instanceof Error ? failure.message : "The outcome is unknown. Retry to check the same creation request.");
    }
    finally { inFlight.current = false; setBusy(false); setProgress(""); }
  }

  if (!ready) return <section className="card card-pad" role="status">Loading campaign details…</section>;
  if (!draft) return <section className="card card-pad"><h1 className="card-title">Campaign details are no longer held</h1>
    <p>The details for this campaign were not kept. Fill them in again, then write the captions.</p>
    <Link prefetch={false} className="link" href={DETAILS}>Back to campaign details</Link></section>;

  const locked = busy || Boolean(saved) || Boolean(recovery);
  return <div className="caption-editor-page" aria-busy={busy}>
    <Link prefetch={false} className="caption-back link" href={DETAILS}><ArrowLeft size={16} aria-hidden /> Back to campaign details</Link>
    <PageHead title="Captions" subtitle={`${draft.name} · Write at least one caption to create this campaign.`}
      actions={<div className="caption-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => router.push("/campaigns")}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={create}
          title={!gate.allowed ? gate.reason : editing ? "Save or cancel this caption first." : !variants.length ? "Write a caption to create this campaign." : undefined}
          disabled={busy || Boolean(saved) || !gate.allowed || Boolean(editing) || !variants.length}>
          {busy ? "Creating…" : recovery ? "Retry original request" : "Create campaign"}
        </button></div>} />
    <div className="caption-editor-feedback">
      {loadError ? <p className="card-note" role="status">Could not refresh save availability. Your captions are kept. {loadError}</p> : null}
      {!gate.allowed ? <p className="card-note" role="status">{gate.reason} You can write the captions here.</p> : null}
      {saved ? <p className="card-note" role="status">{saved.warning} <Link prefetch={false} href={`/campaigns/${saved.slug}`}>Open saved campaign</Link></p> : null}
      {recovery ? <p className="card-note" role="status">Creation may already have been saved. Editing is locked until its outcome is confirmed.
        Retry the original request to check its result. <Link prefetch={false} href={`/campaigns/${recovery.slug}`}>Check campaign</Link></p> : null}
      {storageNotice ? <p className="card-note" role="status">{storageNotice}</p> : null}
      {error ? <p className="caption-error" role="alert">{error}</p> : null}
      {progress ? <p className="card-note" role="status">{progress}</p> : null}
      <span className="card-note" role="status">{variants.length
        ? `${variants.length} caption${variants.length === 1 ? "" : "s"} ready. Variants rotate using the existing campaign rules.`
        : "No captions yet. The campaign is created once at least one is saved."}</span>
    </div>
    {editing ? <>
      <CaptionWorkspace key={editing.id} name={draft.name}
        variantLabel={String(editing.id === "new" ? variants.length + 1 : variants.findIndex((item) => item.id === editing.id) + 1)}
        text={editing.text} disabled={locked} autoFocus aiUnavailableReason={aiUnavailableReason} images={pictures}
        onText={(text) => setEditing((current) => current && { ...current, text })} />
      <div className="campaign-create-submit">
        <button type="button" className="btn" disabled={locked} onClick={() => setEditing(null)}>Cancel caption</button>
        <button type="button" className="btn btn-primary" disabled={locked || !editing.text.trim()} onClick={keep}>Save caption</button>
      </div>
    </> : <section className="card caption-variants" aria-labelledby="campaign-caption-variants-title">
      <div className="card-head">
        <div><h2 className="card-title" id="campaign-caption-variants-title">Caption variants</h2>
          <p className="card-note caption-help">Open a variant to edit it manually or with AI. Group references and WhatsApp links are filled in when sent.</p></div>
        <button type="button" className="btn caption-add" disabled={locked}
          onClick={() => setEditing({ id: "new", text: "" })}><Plus size={16} aria-hidden /> Add variant</button>
      </div>
      <div className="card-pad grid caption-grid">
        {variants.map((item, index) => <div className="caption-variant" key={item.id}>
          <div className="caption-variant-head">
            <span className="pill pill-info" id={`campaign-caption-${item.id}-label`}>Variant {index + 1}</span>
            <div className="caption-variant-actions">
              <button type="button" className="row-action" aria-label={`Edit variant ${index + 1}`} title={`Edit variant ${index + 1}`}
                disabled={locked} onClick={() => setEditing({ id: item.id, text: item.text })}><Pencil size={16} aria-hidden /></button>
              <button type="button" className="row-action row-action-danger" aria-label={`Delete variant ${index + 1}`} title={`Delete variant ${index + 1}`}
                disabled={locked} onClick={() => setVariants((current) => current.filter((entry) => entry.id !== item.id))}><Trash2 size={16} aria-hidden /></button>
            </div>
          </div>
          <pre className="caption-box caption-card-text" aria-labelledby={`campaign-caption-${item.id}-label`}>{item.text}</pre>
        </div>)}
        {!variants.length ? <p className="card-note">No caption variants yet. Add a variant to get started.</p> : null}
      </div>
    </section>}
  </div>;
}
