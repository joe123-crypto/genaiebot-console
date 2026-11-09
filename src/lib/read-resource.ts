/** Serializable server-to-client read results. Retained values belong to the
 * mounted view, never to a server cache or an authoritative console database. */
export type ReadResource<T> =
  | { ok: true; data: T; receivedAt: string }
  | { ok: false; error: { detail: string; status?: number } };
