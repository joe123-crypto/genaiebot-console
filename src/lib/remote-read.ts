/** Shared across Next server bundles and development reloads in this process.
 * The gateway allows only two bridge processes, including overview reads. */
type ReadState = {
  active: number;
  waiting: Array<() => void>;
  pending: Map<string, Promise<unknown>>;
  generation?: number;
};
const runtime = globalThis as typeof globalThis & { __genaieRemoteReads?: ReadState };
const state: ReadState = runtime.__genaieRemoteReads ??= { active: 0, waiting: [], pending: new Map() };

export async function withReadSlot<T>(read: () => Promise<T>): Promise<T> {
  if (state.active >= 2) await new Promise<void>((resolve) => state.waiting.push(resolve));
  else state.active++;
  try {
    return await read();
  } finally {
    const next = state.waiting.shift();
    if (next) next(); // Transfer this reserved slot directly to the next reader.
    else state.active--;
  }
}

/** Share only in-flight work; a completed response is never a state cache. */
export function deduplicateRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  key = `${state.generation ?? 0}:${key}`;
  const pending = state.pending.get(key);
  if (pending) return pending as Promise<T>;
  const result = read().finally(() => { state.pending.delete(key); });
  state.pending.set(key, result);
  return result;
}

/** A read started before a mutation cannot be reused by its follow-up refresh. */
export function invalidateRemoteReads(): void {
  state.generation = (state.generation ?? 0) + 1;
}
