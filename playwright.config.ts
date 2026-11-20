import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      GENAIE_AUTH_E2E: "1",
      APP_ORIGIN: "http://127.0.0.1:3100",
      FIREBASE_PROJECT_ID: "demo-genaie-console",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-genaie-console",
      NEXT_PUBLIC_FIREBASE_API_KEY: "fake-api-key",
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-genaie-console.firebaseapp.com",
      NEXT_PUBLIC_FIREBASE_APP_ID: "demo-console-app",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL: "http://127.0.0.1:9099",
      // The workspace registry lives in the Firestore emulator. Every test user
      // is a new sign-up, so their workspace has no bot and no bot is ever
      // called: there is no console-wide bot address to fall back to.
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8085",
      BOT_TOKEN_SECRET: "e2e-only-token-secret-not-used-for-any-real-bot",
      CONSOLE_WRITES: "",
    },
  },
});
