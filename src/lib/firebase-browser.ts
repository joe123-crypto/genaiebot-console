"use client";
import { getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, inMemoryPersistence, setPersistence } from "firebase/auth";

let initialized: ReturnType<typeof initialize> | undefined;
function initialize() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  if (Object.values(config).some(value => !value)) throw new Error("Sign-in is not configured. Contact the console administrator.");
  const app = getApps().find(app => app.name === "genaie-console") ?? initializeApp(config, "genaie-console");
  const auth = getAuth(app);
  const emulatorUrl = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL;
  if (emulatorUrl) {
    if (process.env.NODE_ENV === "production" || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(emulatorUrl)) throw new Error("Invalid authentication emulator configuration.");
    connectAuthEmulator(auth, emulatorUrl, { disableWarnings: true });
  }
  return { auth, ready: setPersistence(auth, inMemoryPersistence) };
}
export async function firebaseBrowserAuth() {
  initialized ??= initialize();
  await initialized.ready;
  return initialized.auth;
}
