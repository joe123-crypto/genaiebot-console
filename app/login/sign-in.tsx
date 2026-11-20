"use client";
import { useEffect, useState } from "react";
import { authMutation } from "@/src/lib/auth-browser";
const errors: Record<string, string> = {
  "auth/popup-blocked": "Your browser blocked the sign-in window. Allow popups for this site and try again.",
  "auth/popup-closed-by-user": "Sign-in was cancelled. Choose Continue with Google to try again.",
  "auth/cancelled-popup-request": "Another sign-in window is open. Finish signing in there or try again.",
  "auth/unauthorized-domain": "This domain is not authorized for Google sign-in. Contact the console administrator.",
  "auth/operation-not-allowed": "Google sign-in has not been enabled. Contact the console administrator.",
  "auth/network-request-failed": "Could not reach Google sign-in. Check your connection and try again.",
  "auth/user-disabled": "This account has been disabled. Contact the console administrator.",
};
async function loadGoogleSignIn() {
  const [{ firebaseBrowserAuth }, sdk] = await Promise.all([import("@/src/lib/firebase-browser"), import("firebase/auth")]);
  return { auth: await firebaseBrowserAuth(), sdk };
}
let prepared: ReturnType<typeof loadGoogleSignIn> | undefined;
function googleSignIn() {
  prepared ??= loadGoogleSignIn().catch(error => { prepared = undefined; throw error; });
  return prepared;
}
export function LoginForm({ returnTo, unavailable }: { returnTo: string; unavailable: boolean }) {
  const [ready, setReady] = useState(false);
  const [setupFailed, setSetupFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(unavailable ? "Sign-in is temporarily unavailable. Please try again later." : "");
  // Prepare on the login page so opening Google's popup stays close to the
  // user's click. The server-rendered button stays disabled until hydrated and
  // ready, so fast clicks after a session-expiry redirect cannot be lost.
  useEffect(() => {
    let active = true;
    googleSignIn().then(() => { if (active) setReady(true); }).catch(error => {
      if (active) { setSetupFailed(true); setError(error instanceof Error ? error.message : "Could not prepare sign-in. Please try again."); }
    });
    return () => { active = false; };
  }, [attempt]);
  async function signIn() {
    setPending(true); setError("");
    try {
      const { auth, sdk: { GoogleAuthProvider, signInWithPopup, signOut } } = await googleSignIn();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        const { user } = await signInWithPopup(auth, provider);
        await authMutation("POST", { idToken: await user.getIdToken() });
      } finally { await signOut(auth); }
      window.location.replace(returnTo);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      setError(errors[code] || (code ? "Google sign-in could not be completed. Please try again." : error instanceof Error ? error.message : "Sign-in failed. Please try again."));
      setPending(false);
    }
  }
  return <><button className="btn btn-primary login-google" type="button" disabled={pending || !ready} onClick={signIn}>
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36ZM12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.81-1.76-5.6-4.12H3.05v2.59A10 10 0 0 0 12 22ZM6.4 13.92a6 6 0 0 1 0-3.84V7.49H3.05a10 10 0 0 0 0 9.02l3.35-2.59ZM12 5.96c1.47 0 2.79.51 3.83 1.51l2.88-2.87A9.61 9.61 0 0 0 12 2a10 10 0 0 0-8.95 5.49l3.35 2.59C7.19 7.72 9.4 5.96 12 5.96Z" /></svg>
    {pending ? "Signing in…" : ready ? "Continue with Google" : setupFailed ? "Sign-in unavailable" : "Preparing sign-in…"}</button>
    {setupFailed && !ready ? <button type="button" className="btn" onClick={() => { setSetupFailed(false); setError(""); setAttempt(value => value + 1); }}>Retry sign-in setup</button> : null}
    <p role="alert" className="login-error">{error}</p></>;
}
