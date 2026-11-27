import { authFetch } from "@/src/lib/auth-browser";

/** A refused account call, with the status the console's account API answered. */
export class AccountRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** GET, or POST with a JSON body, to the console's own account API. */
export async function request<T>(url: string, body?: Record<string, unknown>): Promise<T> {
  const response = await authFetch(url, { cache: 'no-store', signal: AbortSignal.timeout(65_000),
    ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new AccountRequestError(response.status, value.error || 'Account operation failed. Refresh status before retrying.');
  return value as T;
}

export const message = (error: unknown) => error instanceof Error ? error.message : 'Account controls are unavailable.';
