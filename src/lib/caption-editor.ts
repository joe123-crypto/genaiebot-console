export type CaptionDraft = { version: 1; base: string[]; text: string };

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
  return { version: 1, base: draft.base, text: draft.text };
}

export function editedCaptions(base: string[], variant: string, text: string) {
  return variant === "new" ? [...base, text] : base.map((caption, index) => index === Number(variant) - 1 ? text : caption);
}
