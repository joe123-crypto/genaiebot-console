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
      // A closed loopback port keeps authenticated shell reads off the live bot
      // and prevents the local checkout adapter from touching Firestore.
      BOT_API_BASE_URL: "http://127.0.0.1:1", BOT_API_TOKEN: "", CONSOLE_WRITES: "",
    },
  },
});
