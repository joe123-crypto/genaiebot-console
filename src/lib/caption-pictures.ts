/** Browser-side preparation of a not-yet-uploaded campaign picture for AI
 *  context: a saved campaign's pictures already have public URLs, but these
 *  exist only as local files, so they travel as small data URLs. */
const EDGE = 1024;
const QUALITY = 0.72;

async function shrink(file: File): Promise<string | null> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { return null; }
  try {
    const scale = Math.min(1, EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", QUALITY);
    return url.startsWith("data:image/jpeg;base64,") ? url : null;
  } catch { return null; }
  finally { bitmap.close(); }
}

/** Data URLs for as many of these pictures as could be read, in order. A
 *  picture the browser cannot decode is left out rather than failing the lot. */
export async function picturesForAI(files: File[], limit: number): Promise<string[]> {
  const shrunk = await Promise.all(files.slice(0, limit).map(shrink));
  return shrunk.filter((url): url is string => url !== null);
}
