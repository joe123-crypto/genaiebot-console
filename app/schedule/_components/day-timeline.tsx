"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { clashes, nextUp, runEndsAt, runningNow, withTimes } from "@/src/domains/schedule";
import type { DaySlot } from "@/src/domains/schedule";
import { campaignTitle, clockLabel, plural, worstCaseRunSeconds } from "@/src/lib/format";
import { notifyLiveChange } from "@/app/_components/use-live";
import { saveScheduleAction } from "@/app/schedule/actions";
import type { ScheduleSaveResult } from "@/src/lib/types";

const DAY_MINUTES = 24 * 60;

/** Pointer drags land on five-minute marks. A whole day across one row is
 *  roughly a minute per pixel, so an unsnapped drag could not be aimed; five
 *  minutes is still fine enough to express every slot the manifest uses. */
const SNAP_MINUTES = 5;

/** The last start a bar can be dragged to. A run's worst case may still spill
 *  past midnight — it can today — but a start cannot. */
const LAST_START = DAY_MINUTES - SNAP_MINUTES;

type Times = Record<string, number>;

/** The drafted times, plus the saved ones they were drafted against. Keeping
 *  `base` is what lets the 60s refresh land without erasing a drag, and what
 *  tells us afterwards that the schedule moved underneath it. */
type Draft = { base: Times; times: Times; revision: string };

function clamp(minutes: number) {
  return Math.min(LAST_START, Math.max(0, Math.round(minutes)));
}

function snap(minutes: number) {
  return clamp(Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES);
}

/** Order-independent, so a comparison cannot turn on how a map was built. */
function fingerprint(times: Times) {
  return JSON.stringify(Object.entries(times).sort(([a], [b]) => a.localeCompare(b)));
}

export function DayTimeline({
  slots: serverSlots, nowMinutes, timezone, date, saveUnavailableReason,
}: {
  slots: DaySlot[];
  nowMinutes: number;
  timezone: string;
  date: string;
  saveUnavailableReason?: string;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const [accepted, setAccepted] = useState<{ base: string; result: ScheduleSaveResult } | null>(null);
  const drag = useRef<{ slug: string; startX: number; startMinutes: number; width: number } | null>(null);

  const serverRevision = JSON.stringify([date, serverSlots.map((slot) => [slot.slug, slot.minutes, slot.scheduleEdit])]);
  const slots = accepted?.base === serverRevision ? serverSlots.map((slot) => {
    const updated = accepted.result.campaigns.find((row) => row.slug === slot.slug);
    return updated ? { ...slot, ...updated, time: clockLabel(updated.minutes) } : slot;
  }) : serverSlots;
  const revision = JSON.stringify([date, slots.map((slot) => [slot.slug, slot.minutes, slot.scheduleEdit?.revision])]);

  const saved: Times = Object.fromEntries(slots.map((slot) => [slot.slug, slot.minutes]));
  const times = draft?.times ?? saved;

  const dirty = slots.some((slot) => (times[slot.slug] ?? slot.minutes) !== slot.minutes);
  // The schedule changed under the draft, so the times being edited are no
  // longer the ones that would be saved over.
  const stale = draft !== null && (draft.revision !== revision || fingerprint(draft.base) !== fingerprint(saved));

  /** The day as it would be if the draft were saved. Everything derived — the
   *  overlap rule, the running marker, what is next — reads this, so a dragged
   *  bar is judged on exactly the shape a saved one would be. */
  const view = draft ? withTimes(slots, times) : slots;
  const bySlug = new Map(view.map((slot) => [slot.slug, slot]));

  const hasPendingUpdates = slots.some((slot) => slot.scheduleEdit?.status === "pending");
  const saveFeedback = hasPendingUpdates
    ? "Times saved. Scheduler updates are pending; the bot will retry automatically."
    : "Times saved and confirmed by the scheduler.";
  const activeView = dirty ? view : view.flatMap((slot) => {
    if (slot.scheduleEdit?.status !== "pending") return [slot];
    const minutes = slot.scheduleEdit.confirmedMinutes;
    return minutes === null ? [] : [{ ...slot, minutes, time: clockLabel(minutes) }];
  }).sort((a, b) => a.minutes - b.minutes);
  const running = runningNow(activeView, nowMinutes);
  const runningSlugs = new Set(running.map((slot) => slot.slug));
  const upcoming = nextUp(activeView, nowMinutes);
  const nowOffset = `${(nowMinutes / DAY_MINUTES) * 100}%`;

  const runningNames = running.map((slot) => campaignTitle(slot.slug));
  const sendingNow =
    runningNames.length > 1
      ? `${runningNames.slice(0, -1).join(", ")} and ${runningNames[runningNames.length - 1]}`
      : runningNames[0];

  function move(slug: string, minutes: number) {
    if (saving.current || slots.find((slot) => slot.slug === slug)?.scheduleEdit?.editable === false) return;
    setFeedback(null);
    setDraft((current) => ({
      base: current?.base ?? saved,
      times: { ...(current?.times ?? saved), [slug]: minutes },
      revision: current?.revision ?? revision,
    }));
  }

  function reset() {
    if (saving.current) return;
    drag.current = null;
    setDragging(null);
    setDraft(null);
    setFeedback(null);
  }

  async function save() {
    if (saving.current || !dirty || stale || saveUnavailableReason || !date) return;
    const changes = slots.filter((slot) => (times[slot.slug] ?? slot.minutes) !== slot.minutes)
      .map((slot) => ({ slug: slot.slug, time: clockLabel(times[slot.slug]), expectedRevision: slot.scheduleEdit?.revision ?? "" }));
    saving.current = true;
    setPending(true);
    setFeedback(null);
    try {
      const outcome = await saveScheduleAction({ date, timezone, changes });
      if (!outcome.ok) {
        setFeedback({ error: true, text: outcome.detail });
        return;
      }
      setAccepted({ base: serverRevision, result: outcome });
      setDraft(null);
      setFeedback({ error: false, text: "Times saved." });
    } catch {
      setFeedback({ error: true, text: "Could not confirm the save. Changes may have been saved; retry to check the latest times. Your draft is still here." });
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLSpanElement>, slug: string, minutes: number) {
    if (saving.current || slots.find((slot) => slot.slug === slug)?.scheduleEdit?.editable === false) return;
    if (event.button !== 0) return;
    // The bar's own width has a 6%-of-day floor, so it is not a usable scale.
    // The track it sits in is, and the drag is measured as a delta against it
    // rather than an absolute position, so the bar never jumps to the cursor.
    const track = event.currentTarget.parentElement;
    if (!track) return;
    const width = track.getBoundingClientRect().width;
    if (width <= 0) return;
    // Suppresses the browser's own text selection and element drag — and with
    // them the focus the press would otherwise have given the bar, so it is
    // taken back by hand. Without it, a bar cannot be grabbed and then nudged.
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { slug, startX: event.clientX, startMinutes: minutes, width };
    setDragging(slug);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLSpanElement>) {
    const state = drag.current;
    if (!state) return;
    const delta = ((event.clientX - state.startX) / state.width) * DAY_MINUTES;
    move(state.slug, snap(state.startMinutes + delta));
  }

  function onPointerUp(event: ReactPointerEvent<HTMLSpanElement>) {
    if (!drag.current) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.current = null;
    setDragging(null);
  }

  /** The only way to aim a bar without a mouse, and the only way to reach a
   *  single minute: the pointer snaps to five. */
  function onKeyDown(event: ReactKeyboardEvent<HTMLSpanElement>, slug: string, minutes: number) {
    const step = event.shiftKey ? 1 : SNAP_MINUTES;
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown": next = minutes - step; break;
      case "ArrowRight":
      case "ArrowUp": next = minutes + step; break;
      case "PageDown": next = minutes - 60; break;
      case "PageUp": next = minutes + 60; break;
      case "Home": next = 0; break;
      case "End": next = LAST_START; break;
      default: return;
    }
    event.preventDefault();
    move(slug, clamp(next));
  }

  const found = clashes(view);

  return (
    <>
      {found.length > 0 ? (
        <div className="banner" style={{ display: "block" }} role="status">
          <strong>Two campaigns on one line could overlap.</strong>
          {found.map((clash) => (
            <div key={`${clash.account}-${clash.current.slug}-${clash.next.slug}`} style={{ marginTop: 6 }}>
              On the {clash.account} line, {campaignTitle(clash.current.slug)} can still be sending at{" "}
              {clockLabel(clash.finishes)}, after {campaignTitle(clash.next.slug)} starts at {clash.next.time}.
            </div>
          ))}
        </div>
      ) : null}

      <section className="card" aria-labelledby="day-timeline-title">
        <div className="card-head">
          <div>
            <h2 className="card-title" id="day-timeline-title">Day timeline</h2>
            <span className="card-note">
              Drag a bar along its row to change when the campaign runs. Purple runs on the
              ads line, blue on the default line.
            </span>
          </div>
          <div className="timeline-actions">
            {draft ? (
              <button type="button" className="btn" onClick={reset} disabled={pending}>Reset</button>
            ) : null}
            <button
              type="button"
              className="btn btn-primary"
              title={saveUnavailableReason}
              disabled={!dirty || stale || pending || Boolean(saveUnavailableReason) || !date}
              onClick={save}
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>

        <div className="timeline-feedback">
          {saveUnavailableReason ? <p className="card-note">{saveUnavailableReason}</p> : null}
          {feedback ? (
            <p className={feedback.error ? "caption-error" : "card-note"} role={feedback.error ? "alert" : "status"}>
              {feedback.error ? feedback.text : saveFeedback}
            </p>
          ) : null}
          {stale ? (
            <p className="caption-error" role="alert">
              The schedule changed while you were editing. Reset to load the latest times.
            </p>
          ) : null}
          <p className="card-note" role="status">
            {dirty
              ? "Unsaved times. The bot still runs the saved ones until you save."
              : hasPendingUpdates
                ? "Saved times have pending scheduler updates. Confirmed times are shown beside each affected campaign."
                : "Times are as the bot runs them."}
          </p>
        </div>

        <div className="card-pad">
          {/* Worst case, so a lit bar means "could still be sending", never
              "is sending" — the wording has to stay weaker than the bar, and
              weaker again for a time that has only been dragged. */}
          <div className="timeline-status" role="status">
            <span className={`run-dot${running.length > 0 && !dirty ? " is-live" : ""}`} aria-hidden />
            <span className="cell-mono">
              {clockLabel(nowMinutes)} in {timezone}
            </span>
            <span>
              {dirty ? "If saved: " : ""}
              {running.length > 0
                ? `${sendingNow} could still be sending.`
                : upcoming
                  ? `Nothing sending. ${campaignTitle(upcoming.slug)} is next at ${upcoming.time}.`
                  : "Nothing sending. The day's runs are over."}
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "180px 1fr",
              gap: 12,
              marginBottom: 2,
            }}
          >
            <span />
            <div style={{ position: "relative", height: 14 }} className="cell-mono">
              <span className="timeline-now-label" style={{ left: nowOffset }}>
                now
              </span>
            </div>
          </div>

          {/* Rows stay in saved order. Sorting them by the drafted time would
              move the row out from under the pointer that is dragging it. */}
          <div style={{ display: "grid", gap: 6 }}>
            {slots.map((base) => {
              const slot = bySlug.get(base.slug) ?? base;
              const runMinutes = worstCaseRunSeconds(slot.targetCount) / 60;
              const onAds = (slot.accounts.ads ?? 0) > (slot.accounts.default ?? 0);
              const isRunning = runningSlugs.has(slot.slug) && slot.scheduleEdit?.status !== "pending";
              const isDone = runEndsAt(slot) <= nowMinutes;
              const moved = slot.minutes !== base.minutes;
              const endsAt = clockLabel(runEndsAt(slot));
              const title = campaignTitle(slot.slug);
              const editable = !pending && slot.scheduleEdit?.editable !== false;
              return (
                <div key={slot.slug} style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 12, alignItems: "center" }}>
                  <span>
                    <span className="cell-strong">{title}</span>
                    <br />
                    <span className="cell-mono">
                      {moved ? (
                        <>
                          <span className="timeline-was">{base.time}</span> → <strong>{slot.time}</strong>
                        </>
                      ) : (
                        slot.time
                      )}{" "}
                      · {plural(slot.targetCount, "group")}
                    </span>
                    {slot.scheduleEdit?.status === "pending" ? (
                      <><br /><span className="card-note">
                        Scheduler pending. {slot.scheduleEdit.confirmedMinutes === null
                          ? "No confirmed run on this day."
                          : `Last confirmed: ${clockLabel(slot.scheduleEdit.confirmedMinutes)}.`}
                      </span></>
                    ) : null}
                    {slot.scheduleEdit?.editable === false ? (
                      <><br /><span className="card-note">{slot.scheduleEdit.reason}</span></>
                    ) : null}
                    {isRunning ? (
                      <>
                        <br />
                        <span
                          className="pill pill-success"
                          style={{ marginTop: 3 }}
                          title={
                            moved
                              ? `would start at ${slot.time} and run to ${endsAt} at worst — this time is not saved`
                              : `started at ${slot.time}, worst case runs to ${endsAt} — it may already have finished`
                          }
                        >
                          <span className={`run-dot${moved ? "" : " is-live"}`} aria-hidden />{" "}
                          {moved ? "Would be running" : "Running now"}
                        </span>
                      </>
                    ) : null}
                  </span>
                  <div
                    style={{
                      position: "relative",
                      height: 26,
                      borderRadius: 7,
                      background: "var(--surface-muted)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {moved ? (
                      <span
                        className="timeline-ghost"
                        style={{ left: `${(base.minutes / DAY_MINUTES) * 100}%` }}
                        title={`saved time ${base.time}`}
                        aria-hidden
                      />
                    ) : null}
                    <span
                      className={
                        `timeline-fill is-draggable${onAds ? " is-ads" : ""}` +
                        `${isRunning ? " is-running" : ""}${isDone ? " is-done" : ""}` +
                        `${moved ? " is-moved" : ""}${dragging === slot.slug ? " is-dragging" : ""}`
                      }
                      role="slider"
                      tabIndex={editable ? 0 : -1}
                      aria-disabled={!editable}
                      aria-label={`${title} start time`}
                      aria-valuemin={0}
                      aria-valuemax={LAST_START}
                      aria-valuenow={slot.minutes}
                      aria-valuetext={`${slot.time}, to ${endsAt} at worst`}
                      title={slot.scheduleEdit?.editable === false ? slot.scheduleEdit.reason : `${slot.time} to ${endsAt} at worst — drag to change`}
                      onPointerDown={(event) => onPointerDown(event, slot.slug, slot.minutes)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                      onKeyDown={(event) => onKeyDown(event, slot.slug, slot.minutes)}
                      style={{
                        left: `${(slot.minutes / DAY_MINUTES) * 100}%`,
                        right: "auto",
                        width: `${Math.max(6, (runMinutes / DAY_MINUTES) * 100)}%`,
                        minWidth: 0,
                        justifyContent: "center",
                        fontSize: 10.5,
                      }}
                    >
                      {Math.round(runMinutes)}m
                    </span>
                    <span className="timeline-now" style={{ left: nowOffset }} aria-hidden />
                  </div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "180px 1fr",
              gap: 12,
              marginTop: 10,
              paddingTop: 10,
              borderTop: "1px solid var(--border)",
            }}
          >
            <span />
            {/* Ticks sit at their true percentage of the day, on the same scale
                as the bars, so a dragged time can be read off the axis. */}
            <div className="timeline-axis cell-mono">
              {[0, 6, 12, 18, 24].map((hour) => (
                <span key={hour} style={{ left: `${(hour / 24) * 100}%` }}>
                  {String(hour).padStart(2, "0")}:00
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
