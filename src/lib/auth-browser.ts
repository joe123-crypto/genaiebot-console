"use client";
import { safeReturnTo } from "./auth-types";

export const AUTH_LOGOUT_EVENT = "genaie:logout";
export const AUTH_UID_KEY = "genaie:auth-uid";
const LOGOUT_STORAGE_KEY = "genaie:logout-event";

export function clearConsoleDrafts(scope: "session" | "all" = "all") {
  for (const getStorage of scope === "session" ? [() => sessionStorage] : [() => sessionStorage, () => localStorage]) {
    try {
      const storage = getStorage();
      for (const key of Object.keys(storage)) if (key.startsWith("genaie:") || key.startsWith("genaie-")) storage.removeItem(key);
    } catch { /* Storage can be disabled; mounted drafts disappear on navigation. */ }
  }
}
export function loginLocation(): string {
  return `/login?returnTo=${encodeURIComponent(safeReturnTo(window.location.pathname + window.location.search))}`;
}
let returningToLogin = false;
export function sessionExpired() {
  if (returningToLogin) return;
  returningToLogin = true;
  window.location.replace(loginLocation());
}
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 401) { sessionExpired(); throw new Error("Your session ended. Sign in to continue."); }
  return response;
}
export async function authMutation(method: "POST" | "DELETE", body: object = {}) {
  const csrf = await fetch("/api/auth/csrf", { cache: "no-store" });
  const data = await csrf.json();
  if (!csrf.ok) throw new Error(data.error || "Sign-in is temporarily unavailable.");
  const response = await fetch("/api/auth/session", {
    method, headers: { "Content-Type": "application/json", "X-CSRF-Token": data.token }, body: JSON.stringify(body), cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The authentication request failed. Please try again.");
  return result;
}
export function announceSignOut() {
  clearConsoleDrafts();
  window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));
  try { localStorage.setItem(LOGOUT_STORAGE_KEY, `${Date.now()}:${Math.random()}`); } catch { /* Other tabs will detect the missing cookie on their next request. */ }
}
export function isSignOutEvent(event: StorageEvent) { return event.key === LOGOUT_STORAGE_KEY && event.newValue !== null; }
