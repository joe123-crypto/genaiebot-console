"use client";
import { useState } from "react";
import { announceSignOut, authMutation } from "@/src/lib/auth-browser";
export function SignOut() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    setPending(true); setError("");
    try { await authMutation("DELETE"); announceSignOut(); window.location.replace("/login"); }
    catch (error) { setError(error instanceof Error ? error.message : "Sign-out failed. Please try again."); setPending(false); }
  }
  return <div className="console-sign-out"><button type="button" className="btn" disabled={pending} onClick={signOut}>{pending ? "Signing out…" : "Sign out"}</button>
    {error && <p role="alert">{error}</p>}</div>;
}
