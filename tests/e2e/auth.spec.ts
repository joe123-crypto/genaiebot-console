import { test, expect, type Page } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function emulatorAdmin() {
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") throw new Error("These tests require the local Auth Emulator.");
  const name = "genaie-auth-tests";
  return getAuth(getApps().find(app => app.name === name) ?? initializeApp({ projectId: "demo-genaie-console" }, name));
}

async function signIn(page: Page, email = `console-${Date.now()}@example.com`) {
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  const popup = await popupPromise;
  // The emulator's form is visible before its external UI script attaches the
  // click handlers. Wait for that script before selecting/adding an account.
  await popup.waitForLoadState("domcontentloaded");
  await expect(popup.getByRole("button", { name: "Add new account" })).toBeVisible();
  if (await popup.getByText(email, { exact: true }).count()) await popup.getByText(email, { exact: true }).click();
  else {
    await popup.getByRole("button", { name: "Add new account" }).click();
    await popup.locator("#email-input").fill(email);
    await popup.locator("#display-name-input").fill("Console Tester");
    await popup.locator("#sign-in").click();
  }
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole("complementary")).toBeVisible();
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) await menu.click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  return email;
}

test("Google popup signs in, returns to a deep link, and survives reload", async ({ page, context }) => {
  await page.goto("/setup?source=auth-test");
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  const email = await signIn(page);
  await expect(page).toHaveURL(/\/setup\?source=auth-test$/);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  const cookie = (await context.cookies()).find(cookie => cookie.name === "genaie_console_session")!;
  expect(cookie.httpOnly).toBe(true); expect(cookie.sameSite).toBe("Lax");
  await page.reload(); await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  expect((await page.request.get("/api/auth/session")).ok()).toBe(true);
});

test("logout clears drafts and signs out other open tabs", async ({ page, context }) => {
  await page.goto("/login"); await signIn(page);
  const other = await context.newPage(); await other.goto("/settings");
  await expect(other.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await page.evaluate(() => { sessionStorage.setItem("genaie:caption-editor:v1:test:0", "private draft"); localStorage.setItem("genaie:campaign-groups:v1:test", "private groups"); });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/); await expect(other).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => sessionStorage.getItem("genaie:caption-editor:v1:test:0"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("genaie:campaign-groups:v1:test"))).toBeNull();
  expect((await page.request.get("/api/auth/session")).status()).toBe(401);
});

test("an expired session preserves same-user drafts and a changed user clears them", async ({ page, context }) => {
  await page.goto("/settings"); const email = await signIn(page);
  await page.evaluate(() => sessionStorage.setItem("genaie:caption-editor:v1:test:0", "saved draft"));
  await context.clearCookies({ name: "genaie_console_session" });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  expect(await page.evaluate(() => sessionStorage.getItem("genaie:caption-editor:v1:test:0"))).toBe("saved draft");
  await signIn(page, email);
  expect(await page.evaluate(() => sessionStorage.getItem("genaie:caption-editor:v1:test:0"))).toBe("saved draft");
  await context.clearCookies({ name: "genaie_console_session" });
  await page.reload();
  await signIn(page, `other-${Date.now()}@example.com`);
  expect(await page.evaluate(() => sessionStorage.getItem("genaie:caption-editor:v1:test:0"))).toBeNull();
});

test("direct APIs refuse anonymous requests and external return paths stay local", async ({ page }) => {
  for (const path of ["/api/live/groups", "/api/accounts", "/api/account-membership"]) expect((await page.request.get(path)).status()).toBe(401);
  expect((await page.request.post("/api/campaigns/uploads", { data: {} })).status()).toBe(401);
  await page.goto("/login?returnTo=https%3A%2F%2Fevil.example"); await signIn(page);
  // Home, then on to /setup: a new account's workspace has no bot yet.
  await expect(page).toHaveURL("http://127.0.0.1:3100/setup");
});

test("a new account gets its own empty workspace and reaches no bot", async ({ page }) => {
  await page.goto("/groups"); await signIn(page);
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "No bot connected yet" })).toBeVisible();
  const first = await page.getByText(/^w[A-Za-z0-9_-]{16}$/).textContent();
  const live = await page.request.get("/api/live/groups");
  expect(live.status()).toBe(409);
  expect(await live.json()).toEqual({ error: "No bot is connected to your workspace yet." });
  await page.reload();
  expect(await page.getByText(/^w[A-Za-z0-9_-]{16}$/).textContent()).toBe(first);
});

for (const invalidation of ["disabled", "revoked"] as const) {
  test(`Firebase ${invalidation} users lose access to existing sessions`, async ({ page }) => {
    await page.goto("/settings"); await signIn(page);
    const { operator } = await (await page.request.get("/api/auth/session")).json();
    const admin = emulatorAdmin();
    if (invalidation === "disabled") await admin.updateUser(operator.uid, { disabled: true });
    else {
      // Firebase compares auth_time and revocation times at one-second precision.
      await new Promise(resolve => setTimeout(resolve, 1100));
      await admin.revokeRefreshTokens(operator.uid);
    }
    expect((await page.request.get("/api/auth/session")).status()).toBe(401);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page).toHaveURL(/\/login\?returnTo=/);
  });
}

test("a forged session cookie never authenticates an API request", async ({ page, context }) => {
  await context.addCookies([{ name: "genaie_console_session", value: "forged-token", url: "http://127.0.0.1:3100/" }]);
  expect((await page.request.get("/api/auth/session")).status()).toBe(401);
  await page.goto("/settings"); await expect(page).toHaveURL(/\/login\?returnTo=/);
});
