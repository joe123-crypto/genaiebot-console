import type { Tracking } from "@/src/lib/types";
import { trackingError } from "@/src/lib/tracked-caption-link";
export type CaptionDraft = { version: 1; base: string[]; text: string; baseTracking?: Tracking; tracking?: Tracking };

export function captionEditorHref(slug: string, variant: number | "new") {
  return `/campaigns/${encodeURIComponent(slug)}/captions/${variant}/edit`;
}

export function captionDraftKey(slug: string, variant: string) {
  return `genaie:caption-editor:v1:${slug}:${variant}`;
}

export function isCaptionVariant(value: string) {
  return value === "new" || (/^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)));
}

export function parseCaptionDraft(raw: string): CaptionDraft {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("Invalid caption draft");
  const draft = value as Record<string, unknown>;
  if (draft.version !== 1 || typeof draft.text !== "string" || !Array.isArray(draft.base) ||
      !draft.base.every((text) => typeof text === "string")) throw new Error("Invalid caption draft");
  if ((draft.tracking !== undefined && trackingError(draft.tracking)) || (draft.baseTracking !== undefined && trackingError(draft.baseTracking))) throw new Error("Invalid tracking draft");
  return { version: 1, base: draft.base, text: draft.text,
    ...(draft.baseTracking !== undefined ? { baseTracking: draft.baseTracking as Tracking } : {}),
    ...(draft.tracking !== undefined ? { tracking: draft.tracking as Tracking } : {}) };
}

export function editedCaptions(base: string[], variant: string, text: string) {
  return variant === "new" ? [...base, text] : base.map((caption, index) => index === Number(variant) - 1 ? text : caption);
}
