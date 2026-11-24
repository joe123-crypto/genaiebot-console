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
function GoogleMark() {
  return <svg className="login-google-mark" aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.88.92 7.54 2.55 10.78l7.98-6.19Z" />
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.55 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
  </svg>;
}
export function LoginForm({ returnTo, unavailable }: { returnTo: string; unavailable: boolean }) {
  const [ready, setReady] = useState(false);
  const [setupFailed, setSetupFailed] = useState(false);
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
  }, []);
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
  return <><button className="btn login-google" type="button" disabled={pending || !ready} onClick={signIn}>
    {pending ? <span className="login-spinner" aria-hidden="true" /> : <GoogleMark />}
    <span>{pending ? "Signing in…" : ready ? "Continue with Google" : setupFailed ? "Sign-in unavailable" : "Preparing sign-in…"}</span></button>
    <p role="alert" className="login-error">{error}</p></>;
}
