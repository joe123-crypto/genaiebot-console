"use client";
import { useEffect, useState, type ReactNode } from "react";
import { AUTH_UID_KEY, AUTH_LOGOUT_EVENT, clearConsoleDrafts, isSignOutEvent, sessionExpired } from "@/src/lib/auth-browser";

/** Check the identity before mounting editors that restore browser drafts. */
export function SessionBoundary({ uid, children }: { uid: string; children: ReactNode }) {
  const [readyUid, setReadyUid] = useState<string>();
  useEffect(() => {
    try {
      if (localStorage.getItem(AUTH_UID_KEY) !== uid) clearConsoleDrafts();
      else if (sessionStorage.getItem(AUTH_UID_KEY) !== uid) clearConsoleDrafts("session");
      localStorage.setItem(AUTH_UID_KEY, uid);
      sessionStorage.setItem(AUTH_UID_KEY, uid);
    } catch { /* Editors already handle unavailable storage. */ }
    setReadyUid(uid);
    const signedOut = () => { clearConsoleDrafts(); window.location.replace("/login"); };
    const storage = (event: StorageEvent) => {
      if (isSignOutEvent(event)) signedOut();
      else if (event.key === AUTH_UID_KEY && event.newValue && event.newValue !== uid) {
        clearConsoleDrafts("session"); window.location.reload();
      }
    };
    // A quiet page still detects expiry/revocation when revisited or after a minute.
    async function check() {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        if (response.status === 401) sessionExpired();
        else if (response.ok && (await response.json()).operator.uid !== uid) window.location.reload();
      } catch { /* Network failures are retried on the next visibility/interval check. */ }
    }
    const timer = setInterval(() => void check(), 60_000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    window.addEventListener("storage", storage);
    window.addEventListener(AUTH_LOGOUT_EVENT, signedOut);
    return () => {
      clearInterval(timer); document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check); window.removeEventListener("storage", storage);
      window.removeEventListener(AUTH_LOGOUT_EVENT, signedOut);
    };
  }, [uid]);
  return readyUid === uid ? children : <div className="session-loading" role="status">Opening console…</div>;
}
