"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { activeSlot, clashes, nextUp, runEndsAt, runningNow, slotKey } from "@/src/domains/schedule";
import type { DaySlot } from "@/src/domains/schedule";
import { campaignTitle, clockLabel, timelineClockLabel, plural, worstCaseRunSeconds } from "@/src/lib/format";
import { CalendarCheck, CalendarOff, ClipboardPaste, Copy, Pause, Play, Trash2, X } from "lucide-react";
import { notifyLiveChange } from "@/app/_components/use-live";
import { saveScheduleEntriesAction } from "@/app/schedule/actions";
import type { ScheduleEntriesRequest, ScheduleEntryChange } from "@/src/lib/types";

const POP_WIDTH = 270;
/** Rough popover height, only used to decide whether it opens below or above its bar. */
const POP_ESTIMATE = 180;

type Draft = { base: string; slots: DaySlot[] };
const ordered = (slots: DaySlot[]) => [...slots].sort((first, second) => slotKey(first).localeCompare(slotKey(second)));
const desired = (slot: DaySlot) => [slot.minutes, Boolean(slot.paused), Boolean(slot.skipped), Boolean(slot.deleted)];
const revision = (date: string, slots: DaySlot[]) => JSON.stringify([date, ordered(slots).map((slot) => [slotKey(slot), desired(slot), slot.scheduleEdit?.revision])]);
const snap = (minutes: number) => Math.min(1435, Math.max(0, Math.round(minutes / 5) * 5));
const label = (slot: DaySlot) => campaignTitle(slot.slug);

export function EntryTimeline({ slots: serverSlots, nowMinutes, timezone, date, unavailableReason }: {
  slots: DaySlot[]; nowMinutes: number; timezone: string; date: string; unavailableReason?: string;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const [accepted, setAccepted] = useState<{ base: string; slots: DaySlot[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pasteTime, setPasteTime] = useState("12:00");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uncertain, setUncertain] = useState<ScheduleEntriesRequest | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const saving = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const barRefs = useRef(new Map<string, HTMLSpanElement>());
  const drag = useRef<{ key: string; startX: number; minutes: number; width: number; moved: boolean; previous: Draft | null } | null>(null);
  const suppressClick = useRef(false);
  const snapshot = JSON.stringify([date, ordered(serverSlots)]);
  const slots = accepted?.base === snapshot ? accepted.slots : serverSlots;
  const currentRevision = revision(date, slots);
  const saved = new Map(slots.map((slot) => [slotKey(slot), slot]));
  const view = draft?.slots ?? slots;
  const changes = view.filter((slot) => JSON.stringify(desired(slot)) !== JSON.stringify(saved.has(slotKey(slot)) ? desired(saved.get(slotKey(slot))!) : null));
  const dirty = changes.length > 0;
  const stale = draft !== null && draft.base !== currentRevision;
  const locked = pending || uncertain !== null || Boolean(unavailableReason);
  const selectedSlot = view.find((slot) => slotKey(slot) === selected);
  const groups = new Map<string, DaySlot[]>();
  for (const slot of ordered(view)) groups.set(slot.slug, [...(groups.get(slot.slug) ?? []), slot]);
  const activeView = dirty ? view : view.flatMap((slot) => slot.scheduleEdit?.status !== "pending" ? [slot]
    : slot.confirmed ? [{ ...slot, ...slot.confirmed, time: clockLabel(slot.confirmed.minutes) }] : []);
  const running = runningNow(activeView, nowMinutes);
  const runningKeys = new Set(running.map(slotKey));
  const upcoming = nextUp(activeView, nowMinutes);
  const found = clashes(dirty ? view : activeView);
  const nowOffset = `${nowMinutes / 1440 * 100}%`;

  useEffect(() => { if (selected) panel.current?.focus(); }, [selected]);

  /** Fixed, not absolute: .timeline-scroll clips on both axes, so an in-flow popover is cut off. */
  useEffect(() => {
    if (!selected) { setAnchor(null); return; }
    const place = () => {
      const rect = barRefs.current.get(selected)?.getBoundingClientRect();
      if (!rect) return;
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - POP_WIDTH - 12));
      const below = rect.bottom + 8;
      setAnchor({ left, top: below + POP_ESTIMATE > window.innerHeight ? Math.max(12, rect.top - POP_ESTIMATE - 8) : below });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [selected]);

  function edit(slot: DaySlot, values: Partial<DaySlot>) {
    if (saving.current || locked || slot.scheduleEdit?.editable === false) return;
    setFeedback(null);
    setDraft((previous) => ({ base: previous?.base ?? currentRevision,
      slots: (previous?.slots ?? slots).map((row) => slotKey(row) === slotKey(slot) ? { ...row, ...values } : row) }));
  }
  function move(slot: DaySlot, minutes: number) { edit(slot, { minutes, time: clockLabel(minutes) }); }
  function closeOptions() {
    if (selected) barRefs.current.get(selected)?.focus();
    setSelected(null);
    setConfirmDelete(false);
  }
  function reset() {
    if (saving.current || locked) return;
    drag.current = null;
    setDragging(null);
    setDraft(null);
    setFeedback(null);
    closeOptions();
  }
  function openOptions(slot: DaySlot) {
    if (suppressClick.current) { suppressClick.current = false; return; }
    setSelected(slotKey(slot));
    setPasteTime(clockLabel(Math.min(1439, Math.ceil(runEndsAt(slot) / 5) * 5)));
    setConfirmDelete(false);
  }
  function paste(minutes: number) {
    if (!copied || locked || saving.current || stale) return;
    const source = view.find((slot) => slot.slug === copied && !slot.deleted);
    if (!source || source.scheduleEdit?.editable === false) return;
    const entry: DaySlot = { ...source, entryId: crypto.randomUUID(), minutes, time: clockLabel(minutes), paused: false, skipped: false, deleted: false,
      confirmed: null, recurrence: { timezone, weekdays: [0, 1, 2, 3, 4, 5, 6] } };
    setDraft((previous) => ({ base: previous?.base ?? currentRevision, slots: [...(previous?.slots ?? slots), entry] }));
    setSelected(slotKey(entry));
    setConfirmDelete(false);
    setFeedback(null);
  }
  function remove(slot: DaySlot) {
    if (!saved.has(slotKey(slot))) {
      setDraft((previous) => previous ? { ...previous, slots: previous.slots.filter((row) => slotKey(row) !== slotKey(slot)) } : null);
      closeOptions();
    } else edit(slot, { deleted: true });
    setConfirmDelete(false);
  }
  async function save() {
    if (saving.current || (!uncertain && (!dirty || stale)) || unavailableReason || !date) return;
    const request: ScheduleEntriesRequest = uncertain ?? { operationId: crypto.randomUUID(), date, timezone,
      changes: changes.map((slot): ScheduleEntryChange => ({ slug: slot.slug, entryId: slot.entryId ?? "primary",
        expectedRevision: slot.scheduleEdit?.revision ?? "", create: !saved.has(slotKey(slot)), time: slot.time,
        paused: Boolean(slot.paused), skipped: Boolean(slot.skipped), deleted: Boolean(slot.deleted) })) };
    saving.current = true;
    setPending(true);
    setFeedback(null);
    try {
      const outcome = await saveScheduleEntriesAction(request);
      if (!outcome.ok) {
        setUncertain(outcome.uncertain ? request : null);
        setFeedback({ error: true, text: outcome.detail });
        return;
      }
      const updated = new Map(outcome.entries.map((entry) => [slotKey(entry), entry]));
      const revisions = new Map(outcome.entries.map((entry) => [entry.slug, entry.scheduleEdit!.revision]));
      const merged = view.map((slot) => {
        const entry = updated.get(slotKey(slot));
        return entry ? { ...slot, ...entry } : revisions.has(slot.slug) && slot.scheduleEdit
          ? { ...slot, scheduleEdit: { ...slot.scheduleEdit, revision: revisions.get(slot.slug)! } } : slot;
      });
      setAccepted({ base: snapshot, slots: merged.filter((slot) => !slot.deleted || slot.scheduleEdit?.status === "pending") });
      setUncertain(null);
      setDraft(null);
      closeOptions();
      setFeedback({ error: false, text: outcome.entries.some((entry) => entry.scheduleEdit?.status === "pending")
        ? "Changes saved. Scheduler updates are pending; the bot will retry automatically." : "Changes saved and confirmed by the scheduler." });
      notifyLiveChange();
    } catch {
      setUncertain(request);
      setFeedback({ error: true, text: "Changes may have been saved; your draft is still here. Retry the original request to check its receipt." });
    } finally { saving.current = false; setPending(false); }
  }
  function pointerDown(event: PointerEvent<HTMLSpanElement>, slot: DaySlot) {
    suppressClick.current = false;
    if (locked || slot.deleted || slot.scheduleEdit?.editable === false || event.button !== 0) return;
    const width = event.currentTarget.closest(".timeline-track")?.getBoundingClientRect().width ?? 0;
    if (!width) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { key: slotKey(slot), startX: event.clientX, minutes: slot.minutes, width, moved: false, previous: draft };
  }
  function pointerMove(event: PointerEvent<HTMLSpanElement>, slot: DaySlot) {
    const state = drag.current;
    if (!state || state.key !== slotKey(slot)) return;
    if (!state.moved && Math.abs(event.clientX - state.startX) < 4) return;
    state.moved = true;
    setDragging(state.key);
    move(slot, snap(state.minutes + (event.clientX - state.startX) / state.width * 1440));
  }
  function pointerUp(event: PointerEvent<HTMLSpanElement>, cancelled = false) {
    if (!drag.current) return;
    suppressClick.current = drag.current.moved || cancelled;
    if (cancelled) setDraft(drag.current.previous);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
    setDragging(null);
  }
  function keyDown(event: KeyboardEvent<HTMLSpanElement>, slot: DaySlot) {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); suppressClick.current = false; openOptions(slot); return; }
    if (event.key === "Escape") { closeOptions(); return; }
    if (slot.deleted) return;
    const step = event.shiftKey ? 1 : 5;
    const values: Record<string, number> = { ArrowLeft: slot.minutes - step, ArrowDown: slot.minutes - step,
      ArrowRight: slot.minutes + step, ArrowUp: slot.minutes + step, PageDown: slot.minutes - 60, PageUp: slot.minutes + 60, Home: 0, End: 1435 };
    if (values[event.key] !== undefined) { event.preventDefault(); move(slot, Math.max(0, Math.min(1439, values[event.key]))); }
  }

  return <>
    {found.length > 0 && <div className="banner" style={{ display: "block" }} role="status"><strong>Two runs on one line could overlap.</strong>
      {found.map((clash) => <div key={`${clash.account}-${slotKey(clash.current)}-${slotKey(clash.next)}`}>
        On the {clash.account} line, {label(clash.current)} can still be sending at {timelineClockLabel(clash.finishes)}, after {label(clash.next)} starts at {clash.next.time}.
      </div>)}</div>}
    <section className="card" aria-labelledby="day-timeline-title">
      <div className="card-head"><div><h2 className="card-title" id="day-timeline-title">Day timeline</h2>
        <span className="card-note">Click a bar for options. Drag along its row to change the start time. Length shows the worst-case estimate; purple uses the ads line, blue the default line.</span></div>
        <div className="timeline-actions">{draft && <button type="button" className="btn" onClick={reset} disabled={locked}>Reset</button>}
          <button type="button" className="btn btn-primary" title={unavailableReason} disabled={pending || Boolean(unavailableReason) || !date || (!uncertain && (!dirty || stale))} onClick={save}>
            {pending ? "Saving…" : uncertain ? "Retry original request" : "Save changes"}</button></div>
      </div>
      <div className="timeline-feedback">
        {unavailableReason && <p className="card-note">{unavailableReason}</p>}
        {feedback && <p className={feedback.error ? "caption-error" : "card-note"} role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
        {stale && !uncertain && <p className="caption-error" role="alert">The schedule changed while you were editing. Reset to load the latest times.</p>}
        <p className="card-note" role="status">{dirty ? "Unsaved changes. The bot still runs the saved schedule until you save." : "Saved schedule. Pending updates retain their last-confirmed times."}</p>
      </div>
      <div className="card-pad">
        <div className="timeline-status" role="status"><span className={`run-dot${running.length && !dirty ? " is-live" : ""}`} aria-hidden />
          <span className="cell-mono">{clockLabel(nowMinutes)} in {timezone}</span>
          <span>{dirty ? "If saved: " : ""}{running.length ? `${[...new Set(running.map(label))].join(" and ")} could still be sending.`
            : upcoming ? `Nothing sending. ${label(upcoming)} is next at ${upcoming.time}.` : "Nothing sending. The day's runs are over."}</span></div>
        {copied && <p className="card-note" role="status">Copied {campaignTitle(copied)}. Click an empty time on its row or use Paste below. Added runs recur every day until deleted.</p>}
        <div className="timeline-scroll"><div className="timeline-canvas">
          <div className="timeline-row timeline-header"><strong className="cell-mono">Time · {timezone}</strong><div className="timeline-axis timeline-ruler cell-mono">
            {Array.from({ length: 13 }, (_, index) => index * 2).map((hour) => <span key={hour} style={{ left: `${hour / 24 * 100}%` }}>{String(hour).padStart(2, "0")}:00</span>)}
            <span className="timeline-now-label" style={{ left: nowOffset }}>{clockLabel(nowMinutes)} now</span></div></div>
          {[...groups].map(([slug, campaignSlots]) => <div className="timeline-row" key={slug} data-campaign={slug}>
            <div className="timeline-entry-cell">
              <span className="timeline-entry-name" title={`${label(campaignSlots[0])} · ${plural(campaignSlots[0].targetCount, "group")}`}><span className="cell-strong">{label(campaignSlots[0])}</span> <span className="card-note">· {plural(campaignSlots[0].targetCount, "group")}</span></span>
              {campaignSlots.map((slot, index) => {
                const base = saved.get(slotKey(slot)), moved = base && base.minutes !== slot.minutes;
                return <div className="timeline-entry-label" key={slotKey(slot)}>
                  <button type="button" className="timeline-label-button" onClick={() => { suppressClick.current = false; openOptions(slot); }} aria-label={`${label(slot)} run ${index + 1} options`}>
                    {campaignSlots.length > 1 && `${index + 1}. `}{moved && <><span className="timeline-was">{base.time}</span> → </>}<strong>{slot.time}</strong></button>
                  {" "}<span className="timeline-range">→ {timelineClockLabel(runEndsAt(slot))} · {Math.round(worstCaseRunSeconds(slot.targetCount) / 60)}m</span>
                  {slot.deleted ? <span className="card-note"> · Removal {dirty ? "drafted" : "pending"}</span> : slot.paused ? <span className="card-note"> · Paused</span> : slot.skipped ? <span className="card-note"> · Skipped {date}</span> : null}
                  {slot.campaignEnabled === false && <span className="card-note"> · Campaign off</span>}
                  {slot.scheduleEdit?.status === "pending" && <div className="card-note">Scheduler pending. {slot.confirmed ? `Last confirmed: ${clockLabel(slot.confirmed.minutes)}${slot.confirmed.paused ? ", paused" : slot.confirmed.skipped ? ", skipped" : slot.confirmed.deleted ? ", deleted" : ""}.` : "No confirmed run on this day."}</div>}
                  {slot.scheduleEdit?.editable === false && <div className="card-note">{slot.scheduleEdit.reason}</div>}
                </div>;
              })}
            </div>
            <div className="timeline-track" onClick={(event) => {
              if (event.target !== event.currentTarget || copied !== slug || suppressClick.current) { suppressClick.current = false; return; }
              const bounds = event.currentTarget.getBoundingClientRect();
              if (bounds.width) paste(snap((event.clientX - bounds.left) / bounds.width * 1440));
            }}>
              {campaignSlots.map((slot, index) => {
                const key = slotKey(slot), base = saved.get(key), moved = base && base.minutes !== slot.minutes;
                const minutes = worstCaseRunSeconds(slot.targetCount) / 60, endsAt = timelineClockLabel(runEndsAt(slot));
                return <span key={key}>
                  {moved && <span className="timeline-ghost" style={{ left: `${base.minutes / 1440 * 100}%` }} title={`saved time ${base.time}`} aria-hidden />}
                  <span ref={(element) => { if (element) barRefs.current.set(key, element); else barRefs.current.delete(key); }}
                    className={`timeline-fill is-draggable${(slot.accounts.ads ?? 0) > (slot.accounts.default ?? 0) ? " is-ads" : ""}${runningKeys.has(key) && activeSlot(slot) ? " is-running" : ""}${runEndsAt(slot) <= nowMinutes ? " is-done" : ""}${!activeSlot(slot) ? " is-inactive" : ""}${moved ? " is-moved" : ""}${dragging === key ? " is-dragging" : ""}${selected === key ? " is-selected" : ""}`}
                    role="slider" tabIndex={0} aria-disabled={locked || slot.deleted || slot.scheduleEdit?.editable === false}
                    aria-label={`${label(slot)} run ${index + 1} start time`} aria-valuemin={0} aria-valuemax={1439} aria-valuenow={slot.minutes}
                    aria-valuetext={`${slot.time}, to ${endsAt} at worst`} aria-haspopup="dialog" aria-controls={selected === key ? "timeline-options" : undefined}
                    title={`${slot.time} to ${endsAt} at worst — click for options or drag to change`}
                    onClick={(event) => { event.stopPropagation(); openOptions(slot); }} onPointerDown={(event) => pointerDown(event, slot)}
                    onPointerMove={(event) => pointerMove(event, slot)} onPointerUp={(event) => pointerUp(event)} onPointerCancel={(event) => pointerUp(event, true)}
                    onKeyDown={(event) => keyDown(event, slot)}
                    style={{ left: `${slot.minutes / 1440 * 100}%`, right: "auto", width: `${Math.min(minutes, 1440 - slot.minutes) / 1440 * 100}%`, minWidth: 0 }}>
                    <span className="timeline-duration">{slot.time} – {endsAt} · {Math.round(minutes)}m at worst</span></span>
                </span>;
              })}<span className="timeline-now" style={{ left: nowOffset }} aria-hidden />
            </div>
          </div>)}
        </div></div>
        {selectedSlot && <div className="timeline-pop" id="timeline-options" role="dialog" aria-modal="false" aria-labelledby="timeline-options-title" tabIndex={-1} ref={panel}
          style={{ top: anchor?.top ?? 0, left: anchor?.left ?? 0, width: POP_WIDTH }}
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); closeOptions(); } }}>
          <div className="timeline-pop-head"><h3 id="timeline-options-title">{label(selectedSlot)}</h3>
            <button type="button" className="icon-btn" aria-label="Close options" title="Close options" onClick={closeOptions}><X size={15} aria-hidden /></button></div>
          <p className="timeline-pop-meta">{selectedSlot.time} – {timelineClockLabel(runEndsAt(selectedSlot))} · {Math.round(worstCaseRunSeconds(selectedSlot.targetCount) / 60)}m at worst
            {selectedSlot.recurrence && <> · {selectedSlot.recurrence.weekdays.length === 7 ? "every day" : selectedSlot.recurrence.weekdays.map((day) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day]).join(", ")}</>}</p>
          <label className="timeline-time-input">Start <input aria-label="Start time" type="time" value={selectedSlot.time} disabled={locked || selectedSlot.deleted || selectedSlot.scheduleEdit?.editable === false}
            onChange={(event) => { if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(event.target.value)) { const [hour, minute] = event.target.value.split(":").map(Number); move(selectedSlot, hour * 60 + minute); } }} /></label>
          <fieldset disabled={locked || stale || selectedSlot.scheduleEdit?.editable === false || selectedSlot.deleted} className="timeline-pop-actions">
            <button type="button" className="icon-btn" aria-label={selectedSlot.paused ? "Resume" : "Pause"} title={selectedSlot.paused ? "Resume" : "Pause"}
              onClick={() => edit(selectedSlot, { paused: !selectedSlot.paused })}>{selectedSlot.paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}</button>
            <button type="button" className="icon-btn" aria-label={selectedSlot.skipped ? "Undo skip" : "Skip this day"} title={selectedSlot.skipped ? "Undo skip" : `Skip ${date}`}
              onClick={() => edit(selectedSlot, { skipped: !selectedSlot.skipped })}>{selectedSlot.skipped ? <CalendarCheck size={15} aria-hidden /> : <CalendarOff size={15} aria-hidden />}</button>
            <button type="button" className={`icon-btn${copied === selectedSlot.slug ? " is-on" : ""}`} aria-label="Copy" title="Copy this run"
              onClick={() => setCopied(selectedSlot.slug)}><Copy size={15} aria-hidden /></button>
            <span className="timeline-pop-paste"><input aria-label="Paste time" type="time" value={pasteTime} onChange={(event) => setPasteTime(event.target.value)} />
              <button type="button" className="icon-btn" aria-label="Paste daily repeat" title="Paste a daily repeat at this time"
                disabled={!copied || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(pasteTime)}
                onClick={() => { const [hour, minute] = pasteTime.split(":").map(Number); paste(hour * 60 + minute); }}><ClipboardPaste size={15} aria-hidden /></button></span>
            <button type="button" className="icon-btn is-danger" aria-label="Delete scheduled run" title="Delete this recurring run"
              onClick={() => setConfirmDelete(true)}><Trash2 size={15} aria-hidden /></button>
            {confirmDelete && <div className="timeline-pop-confirm"><p>Delete this recurring run? Its campaign and other runs stay.</p>
              <button type="button" className="btn btn-danger" onClick={() => remove(selectedSlot)}>Confirm delete run</button>
              <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button></div>}
          </fieldset>
          {selectedSlot.deleted && <p className="timeline-pop-meta">Removed when you save. Reset to undo.</p>}
        </div>}
      </div>
    </section>
  </>;
}
