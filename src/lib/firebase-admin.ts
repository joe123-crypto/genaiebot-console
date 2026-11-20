import "server-only";
import { applicationDefault, cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

export class AuthUnavailableError extends Error {
  constructor() { super("Sign-in is temporarily unavailable. Please try again later."); this.name = "AuthUnavailableError"; }
}

export function appOrigin(): string {
  try {
    authEmulatorEnabled();
    const url = new URL(process.env.APP_ORIGIN || "http://localhost:3000");
    if (url.origin !== url.href.replace(/\/$/, "") || url.username || url.password ||
        (process.env.NODE_ENV === "production" && url.protocol !== "https:") ||
        !["http:", "https:"].includes(url.protocol)) throw new Error();
    return url.origin;
  } catch { throw new AuthUnavailableError(); }
}

export function authEmulatorEnabled(): boolean {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const publicUrl = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL;
  if (!host && !publicUrl) return false;
  // Production builds must never accept unsigned emulator tokens.
  if (process.env.NODE_ENV === "production" || !host || !publicUrl ||
      !/^(localhost|127\.0\.0\.1):\d+$/.test(host) || publicUrl !== `http://${host}`) throw new AuthUnavailableError();
  return true;
}

/** The one Admin app, shared by Auth and the workspace registry. */
function firebaseAdminApp(): App {
  authEmulatorEnabled();
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId || projectId !== process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) throw new AuthUnavailableError();
  const name = "genaie-console-auth";
  const existing = getApps().find(app => app.name === name);
  if (existing) return existing;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (Boolean(clientEmail) !== Boolean(privateKey)) throw new AuthUnavailableError();
  try {
    return initializeApp({ projectId, credential: clientEmail && privateKey
      ? cert({ projectId, clientEmail, privateKey }) : applicationDefault() }, name);
  } catch { throw new AuthUnavailableError(); }
}

export function firebaseAdminAuth() {
  return getAuth(firebaseAdminApp());
}

/**
 * The workspace registry: `users/{uid}` and `workspaces/{id}` in the project's
 * `(default)` database. The console reads and creates only those two documents;
 * a workspace's own data is written by its bot, never from here.
 */
export function firestoreAdmin(): Firestore {
  return getFirestore(firebaseAdminApp());
}
