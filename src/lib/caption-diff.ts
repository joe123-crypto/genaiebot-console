/** How much shorter a suggestion is than the caption it was built from, as a
 *  whole percentage. A model can drop a line while reporting that it changed
 *  nothing else, so a visibly smaller suggestion is worth pointing at. */
export const SHRINK_NOTICE = 30;

export function shrinkPercent(before: string, after: string) {
  const original = Array.from(before).length;
  if (!original) return 0;
  const lost = original - Array.from(after).length;
  return lost <= 0 ? 0 : Math.round((lost / original) * 100);
}
