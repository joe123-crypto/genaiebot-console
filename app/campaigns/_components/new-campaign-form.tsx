"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { createCampaignAction } from "@/app/campaigns/new/actions";
import { ALL_WEEKDAYS, WEEKDAYS, CAMPAIGN_IMAGE_ACCEPT, CAMPAIGN_IMAGE_BYTES, campaignSlug, campaignCreateError,
  type CampaignImageUpload, type NewCampaign } from "@/src/domains/campaign-create";
import type { Group, Tracking } from "@/src/lib/types";
import type { WriteGate } from "@/src/lib/write-capabilities";

type GroupChoice = Pick<Group, "jid" | "name" | "account" | "status">;
type Picture = { id: string; file: File; preview: string; uploaded?: CampaignImageUpload };
function Days({ value, onChange, allowed = ALL_WEEKDAYS, label }: {
  value: number[]; onChange: (days: number[]) => void; allowed?: number[]; label: string;
}) {
  return <div className="campaign-weekdays" role="group" aria-label={label}>{WEEKDAYS.map((day, index) =>
    <label key={day}><input type="checkbox" checked={value.includes(index)} disabled={!allowed.includes(index)}
      onChange={(event) => onChange(event.target.checked ? [...value, index].sort() : value.filter((item) => item !== index))} />{day}</label>)}</div>;
}
export function NewCampaignForm({ groups: incomingGroups, gate, loadError }: { groups: GroupChoice[]; gate: WriteGate; loadError?: string }) {
  const [lastGroups, setLastGroups] = useState(incomingGroups);
  if (!loadError && lastGroups !== incomingGroups) setLastGroups(incomingGroups);
  const groups = loadError ? lastGroups : incomingGroups;
  const router = useRouter();
  const [name, setName] = useState("");
  const [captions, setCaptions] = useState([""]);
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [time, setTime] = useState("");
  const [days, setDays] = useState([...ALL_WEEKDAYS]);
  const [cadence, setCadence] = useState("daily");
  const [timezone, setTimezone] = useState("Africa/Harare");
  const [selected, setSelected] = useState<Record<string, { paused?: boolean; weekdays?: number[] }>>({});
  const [search, setSearch] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [tracking, setTracking] = useState<Tracking>({});
  const [comment, setComment] = useState("");
  const [weeklyComment, setWeeklyComment] = useState("");
  const [timeout, setTimeoutValue] = useState("");
  const [alertTo, setAlertTo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [saved, setSaved] = useState<{ slug: string; warning: string } | null>(null);
  const inFlight = useRef(false);
  const requestId = useRef("");
  const urls = useRef(new Set<string>());
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); }, []);
  const slug = campaignSlug(name);
  const campaignDays = cadence === "daily" ? ALL_WEEKDAYS : days;
  const query = search.trim().toLowerCase();
  const matching = groups.filter((group) => `${group.name ?? "Unnamed group"} ${group.jid} ${group.account}`.toLowerCase().includes(query));
  const unavailable = Object.keys(selected).filter((jid) => !groups.some((group) => group.jid === jid && group.status === "active"));
  function pick(files: FileList | null) {
    if (!files) return;
    const list = Array.from(files);
    const invalid = list.find((file) => !CAMPAIGN_IMAGE_ACCEPT.split(",").includes(file.type) || file.size <= 0 || file.size > CAMPAIGN_IMAGE_BYTES);
    if (invalid) { setError(`${invalid.name}: choose a nonempty JPEG or PNG picture up to 6 MiB.`); return; }
    if (pictures.length + list.length > 20) { setError("Choose at most 20 pictures."); return; }
    if (new Set([...pictures.map((item) => item.file.name), ...list.map((file) => file.name)]).size !== pictures.length + list.length) { setError("Choose pictures with different filenames."); return; }
    setError("");
    setPictures((current) => [...current, ...list.map((file) => {
      const preview = URL.createObjectURL(file); urls.current.add(preview);
      return { id: crypto.randomUUID(), file, preview };
    })]);
  }
  function remove(id: string) {
    const item = pictures.find((picture) => picture.id === id);
    if (item) { URL.revokeObjectURL(item.preview); urls.current.delete(item.preview); }
    setPictures((current) => current.filter((picture) => picture.id !== id));
  }
  function move(index: number, offset: number) {
    setPictures((current) => { const next = [...current]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; });
  }
  async function describe(picture: Picture): Promise<CampaignImageUpload> {
    if (picture.uploaded?.key.startsWith(`ads/${slug}/`)) return picture.uploaded;
    const digest = await crypto.subtle.digest("SHA-256", await picture.file.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const contentType = picture.file.type as CampaignImageUpload["contentType"];
    const extension = contentType === "image/png" ? "png" : "jpg";
    const safeName = picture.file.name.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[^A-Za-z0-9]+/, "")
      .replace(/\.(jpg|jpeg|png)$/i, (suffix) => suffix.toLowerCase());
    const filename = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(jpg|jpeg|png)$/.test(safeName) ? safeName : `image-${sha256.slice(0, 12)}.${extension}`;
    return { filename, sha256, contentType, bytes: picture.file.size,
      key: `ads/${slug}/${sha256}.${contentType === "image/png" ? "png" : "jpg"}` };
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !gate.allowed || saved) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      requestId.current ||= crypto.randomUUID();
      const images = await Promise.all(pictures.map(describe));
      const configuredTracking = Object.fromEntries(Object.entries(tracking).filter(([, value]) => value?.trim()).map(([key, value]) => [key, value!.trim()]));
      const input: NewCampaign = { requestId: requestId.current, slug, name: name.trim(), enabled, captions, images,
        schedule: { time, timezone: timezone.trim() || "Africa/Harare", weekdays: [...campaignDays] },
        groups: Object.entries(selected).map(([jid, settings]) => ({ jid, ...settings })),
        ...(Object.keys(configuredTracking).length ? { tracking: configuredTracking } : {}),
        ...(comment.trim() ? { comment: comment.trim() } : {}), ...(weeklyComment.trim() ? { weeklyComment: weeklyComment.trim() } : {}),
        ...(timeout ? { timeoutSeconds: Number(timeout) } : {}), ...(alertTo.trim() ? { failureAlertTo: alertTo.trim() } : {}) };
      const invalid = campaignCreateError(input);
      if (invalid) { setError(invalid); return; }
      for (let index = 0; index < pictures.length; index++) {
        const picture = pictures[index], image = images[index];
        if (picture.uploaded?.key === image.key) continue;
        setProgress(`Uploading picture ${index + 1} of ${pictures.length}…`);
        const signed = await fetch("/api/campaigns/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, image }) });
        const upload = await signed.json();
        if (!signed.ok) throw new Error(upload.error || "The upload could not be prepared.");
        const response = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: picture.file });
        // Immutable keys: a previous identical upload is verified by the bot.
        if (!response.ok && response.status !== 412) throw new Error(`Picture ${index + 1} could not upload. Your form is kept; try again.`);
        setPictures((current) => current.map((item) => item.id === picture.id ? { ...item, uploaded: image } : item));
      }
      setProgress("Saving campaign and schedule…");
      const result = await createCampaignAction(input);
      if (!result.ok) { setError(result.detail); return; }
      if (result.scheduling === "pending") {
        setSaved({ slug: result.slug, warning: result.warning || "Campaign saved. Scheduling is pending; the bot will retry automatically." });
      } else { router.push(`/campaigns/${result.slug}`); router.refresh(); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The outcome is unknown. Retry this form to check the same creation request."); }
    finally { inFlight.current = false; setBusy(false); setProgress(""); }
  }
  return <form className="new-campaign" onSubmit={submit}>
    {loadError ? <div className="banner" role="status">Could not refresh groups or save availability. Your form is kept. {loadError}</div> : null}
    {!gate.allowed ? <div className="banner" role="status">{gate.reason} You can prepare the form here.</div> : null}
    {saved ? <div className="banner" role="status">{saved.warning} <Link href={`/campaigns/${saved.slug}`}>Open saved campaign</Link></div> : null}
    <fieldset disabled={busy || Boolean(saved)} className="campaign-create-fields">
      <section className="card card-pad"><h2 className="card-title">Campaign</h2>
        <label className="modal-label" htmlFor="campaign-name">Name</label><input className="modal-input" id="campaign-name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        {slug ? <p className="card-note">Campaign ID: {slug}</p> : null}
        <label className="campaign-check"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />Enabled</label>
        <p className="card-note">Starts switched off. When enabled, it posts at the next scheduled time.</p>
      </section>
      <section className="card card-pad"><h2 className="card-title">Pictures</h2>
        <p className="card-note">JPEG or PNG, up to 6 MiB each. Multiple pictures rotate one per scheduled run in this order.</p>
        <label className="modal-label" htmlFor="campaign-pictures">Add pictures</label><input id="campaign-pictures" type="file" accept={CAMPAIGN_IMAGE_ACCEPT} multiple onChange={(event) => { pick(event.target.files); event.target.value = ""; }} />
        <div className="campaign-create-pictures">{pictures.map((picture, index) => <figure key={picture.id}>
          {/* Local object URLs are previews of files that have not been uploaded. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={picture.preview} alt={`Picture ${index + 1}: ${picture.file.name}`} />
          <figcaption>{index + 1}. {picture.file.name}</figcaption><div className="campaign-create-picture-actions">
            <button className="btn" type="button" disabled={index === 0} aria-label={`Move picture ${index + 1} up`} onClick={() => move(index, -1)}><ArrowUp size={14} /></button>
            <button className="btn" type="button" disabled={index === pictures.length - 1} aria-label={`Move picture ${index + 1} down`} onClick={() => move(index, 1)}><ArrowDown size={14} /></button>
            <button className="btn" type="button" aria-label={`Remove picture ${index + 1}`} onClick={() => remove(picture.id)}><Trash2 size={14} /></button>
          </div></figure>)}</div>
      </section>
      <section className="card card-pad"><h2 className="card-title">Captions</h2><p className="card-note">Variants rotate using the existing campaign rules. You can use {"{bot_number}"}, {"{ref}"}, and {"{ref_link}"}.</p>
        {captions.map((caption, index) => <div key={index} className="campaign-create-caption"><label className="modal-label" htmlFor={`caption-${index}`}>Caption {index + 1}</label>
          <textarea id={`caption-${index}`} required rows={5} className="modal-input" value={caption} onChange={(event) => setCaptions((current) => current.map((text, at) => at === index ? event.target.value : text))} />
          <button className="btn" type="button" disabled={captions.length === 1} aria-label={`Remove caption ${index + 1}`} onClick={() => setCaptions((current) => current.filter((_, at) => at !== index))}>Remove variant</button></div>)}
        <button className="btn" type="button" onClick={() => setCaptions((current) => [...current, ""])}><Plus size={14} />Add variant</button>
      </section>
      <section className="card card-pad"><h2 className="card-title">Schedule</h2><div className="campaign-create-columns">
        <div><label className="modal-label" htmlFor="campaign-time">Posting time</label><input className="modal-input" id="campaign-time" type="time" required value={time} onChange={(event) => setTime(event.target.value)} /><p className="card-note">{timezone || "Africa/Harare"}</p></div>
        <div><label className="modal-label" htmlFor="campaign-cadence">Repeat</label><select className="modal-input" id="campaign-cadence" value={cadence} onChange={(event) => setCadence(event.target.value)}><option value="daily">Every day</option><option value="weekdays">Selected weekdays</option></select></div></div>
        {cadence === "weekdays" ? <Days label="Campaign weekdays" value={days} onChange={setDays} /> : null}
      </section>
      <section className="card card-pad"><h2 className="card-title">Groups</h2><p className="card-note">Each group uses its existing sending line. {Object.keys(selected).length} selected.</p>
        <label className="modal-label" htmlFor="campaign-group-search">Search groups</label><input id="campaign-group-search" className="modal-input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, group ID or line…" />
        <div className="campaign-create-group-actions"><button className="btn" type="button" onClick={() => setSelected((current) => ({ ...current, ...Object.fromEntries(matching.filter((group) => group.status === "active").map((group) => [group.jid, current[group.jid] ?? {}])) }))}>Select matching active groups</button>
          <button className="btn" type="button" onClick={() => setSelected({})}>Clear selection</button></div>
        <div className="campaign-create-groups" role="group" aria-label="Campaign groups">{matching.map((group) => <label key={group.jid}>
          <input type="checkbox" checked={Boolean(selected[group.jid])} disabled={group.status !== "active"} onChange={(event) => setSelected((current) => { const next = { ...current }; if (event.target.checked) next[group.jid] = {}; else delete next[group.jid]; return next; })} />
          <span><strong>{group.name ?? "Unnamed group"}</strong><small>{group.jid} · {group.account}{group.status !== "active" ? ` · ${group.status}` : ""}</small></span></label>)}
          {!matching.length ? <p className="card-note">No groups match.</p> : null}</div>
        {unavailable.length ? <p role="alert">Selected groups are unavailable: {unavailable.join(", ")} <button type="button" className="btn" onClick={() => setSelected((current) => Object.fromEntries(Object.entries(current).filter(([jid]) => !unavailable.includes(jid))))}>Remove unavailable groups</button></p> : null}
      </section>
      <details className="card card-pad campaign-create-advanced"><summary>Advanced settings <span className="card-note">Optional</span></summary>
        <p className="card-note">Leave these fields blank to use the existing defaults.</p>
        <label className="modal-label" htmlFor="campaign-timezone">Timezone</label><input className="modal-input" id="campaign-timezone" placeholder="Africa/Harare" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
        <h3>Tracking and contact</h3>{([ ["prefix", "Ref prefix"], ["label", "Tracking label"], ["number", "Contact number override"], ["prefill", "WhatsApp message template"], ["link_line", "Link line template"] ] as const).map(([key, label]) => <div key={key}><label className="modal-label" htmlFor={`tracking-${key}`}>{label}</label><input className="modal-input" id={`tracking-${key}`} value={tracking[key] ?? ""} onChange={(event) => setTracking((current) => ({ ...current, [key]: event.target.value }))} /></div>)}
        <p className="card-note">Tracking is off when blank. Set a ref prefix to enable it. Without a contact override, the existing shared contact or posting number is used.</p>
        <h3>Group restrictions</h3><p className="card-note">Groups inherit campaign weekdays. Optional restrictions must use those weekdays; pausing affects this campaign only.</p>
        {Object.entries(selected).map(([jid, settings]) => <div className="campaign-create-restriction" key={jid}><strong>{groups.find((group) => group.jid === jid)?.name ?? jid}</strong>
          <label className="campaign-check"><input type="checkbox" checked={settings.paused ?? false} onChange={(event) => setSelected((current) => ({ ...current, [jid]: { ...current[jid], paused: event.target.checked } }))} />Pause for this campaign</label>
          <label className="campaign-check"><input type="checkbox" checked={settings.weekdays !== undefined} onChange={(event) => setSelected((current) => ({ ...current, [jid]: { ...current[jid], weekdays: event.target.checked ? [...campaignDays] : undefined } }))} />Restrict weekdays</label>
          {settings.weekdays !== undefined ? <Days label={`Weekdays for ${jid}`} value={settings.weekdays} allowed={campaignDays} onChange={(weekdays) => setSelected((current) => ({ ...current, [jid]: { ...current[jid], weekdays } }))} /> : null}</div>)}
        <h3>Operational settings</h3>
        <label className="modal-label" htmlFor="campaign-note">Campaign note</label><textarea id="campaign-note" className="modal-input" maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)} />
        <label className="modal-label" htmlFor="campaign-weekly-note">Weekly note</label><textarea id="campaign-weekly-note" className="modal-input" maxLength={2000} value={weeklyComment} onChange={(event) => setWeeklyComment(event.target.value)} />
        <label className="modal-label" htmlFor="campaign-timeout">Execution timeout (seconds)</label><input id="campaign-timeout" className="modal-input" type="number" min={60} max={7200} placeholder="7200" value={timeout} onChange={(event) => setTimeoutValue(event.target.value)} />
        <label className="modal-label" htmlFor="campaign-alert">Failure alert WhatsApp number</label><input id="campaign-alert" className="modal-input" placeholder="Off by default" value={alertTo} onChange={(event) => setAlertTo(event.target.value)} />
      </details>
    </fieldset>
    {error ? <div className="modal-error" role="alert">{error}</div> : null}
    <div className="campaign-create-submit"><button className="btn" type="button" disabled={busy} onClick={() => router.push("/campaigns")}>Cancel</button><button className="btn btn-primary" type="submit" disabled={busy || !gate.allowed || Boolean(saved)}>{busy ? "Creating…" : "Create campaign"}</button></div>
    {progress ? <p role="status">{progress}</p> : null}
  </form>;
}
