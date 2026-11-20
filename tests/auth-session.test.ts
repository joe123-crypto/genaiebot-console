import { beforeEach, describe, expect, it, vi } from "vitest";
vi.unmock("@/src/lib/auth");
const mocks = vi.hoisted(() => ({
  cookie: "valid-session" as string | undefined,
  verifySession: vi.fn(), verifyId: vi.fn(), createSession: vi.fn(),
  admin: vi.fn(), origin: "https://console.example", csrf: "a".repeat(64),
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), cache: <T>(fn: T) => fn }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => ({ value: name === "genaie_console_csrf" ? mocks.csrf : mocks.cookie }) }),
  headers: async () => new Headers({ "x-genaie-return-to": "/campaigns?q=trees" }),
}));
vi.mock("next/navigation", () => ({ redirect: (location: string) => { throw new Error(`REDIRECT:${location}`); } }));
vi.mock("@/src/lib/firebase-admin", () => ({
  firebaseAdminAuth: mocks.admin,
  appOrigin: () => mocks.origin,
  AuthUnavailableError: class extends Error { constructor() { super("Auth unavailable"); } },
}));
import { getOperator, requireOperator, apiOperator, operatorFromToken, auditActor } from "@/src/lib/auth";
import { POST, DELETE, GET } from "@/app/api/auth/session/route";
import { GET as csrf } from "@/app/api/auth/csrf/route";
import { safeReturnTo } from "@/src/lib/auth-types";
const token = () => ({ uid: "google-user", sub: "google-user", aud: "database-8982a", iss: "https://session.firebase.google.com/database-8982a", iat: 0, exp: 9999999999, email: "user@example.com", name: "Google User", email_verified: true,
  auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: "google.com", identities: {} } });
function request(method = "POST", value: unknown = { idToken: "id-token" }, extra: Record<string, string> = {}) {
  return new Request("https://console.example/api/auth/session", { method,
    headers: { origin: mocks.origin, "content-type": "application/json", "x-csrf-token": mocks.csrf, ...extra }, body: JSON.stringify(value) });
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.cookie = "valid-session"; mocks.origin = "https://console.example"; mocks.csrf = "a".repeat(64);
  mocks.admin.mockReturnValue({ verifySessionCookie: mocks.verifySession, verifyIdToken: mocks.verifyId, createSessionCookie: mocks.createSession });
  mocks.verifySession.mockResolvedValue(token()); mocks.verifyId.mockResolvedValue(token()); mocks.createSession.mockResolvedValue("new-session");
});
describe("verified Firebase sessions", () => {
  it("verifies revocation and returns the authenticated identity", async () => {
    expect(await getOperator()).toEqual({ uid: "google-user", email: "user@example.com", name: "Google User" });
    expect(mocks.verifySession).toHaveBeenCalledWith("valid-session", true);
    expect(auditActor((await getOperator())!)).toBe("user@example.com (google-user)");
  });
  it("keeps audit identities within the existing bot contracts", () => {
    const actor = auditActor({ uid: "google-user", email: `${"long".repeat(50)}@example.com`, name: "Name" });
    expect(actor.length).toBeLessThanOrEqual(120); expect(actor).toContain("(google-user)");
    const longUid = auditActor({ uid: "u".repeat(128), email: "user@example.com", name: "Name" });
    expect(longUid.length).toBeLessThanOrEqual(120); expect(longUid).toContain("uid-sha256:");
  });
  it("does not initialize Firebase for an absent cookie", async () => {
    mocks.cookie = undefined; expect(await getOperator()).toBeNull(); expect(mocks.admin).not.toHaveBeenCalled();
    await expect(requireOperator()).rejects.toThrow("REDIRECT:/login?returnTo=%2Fcampaigns%3Fq%3Dtrees");
    expect((await apiOperator() as Response).status).toBe(401);
  });
  it.each(["auth/argument-error", "auth/invalid-session-cookie", "auth/session-cookie-expired", "auth/session-cookie-revoked", "auth/user-disabled", "auth/user-not-found"])("rejects %s", async code => {
    mocks.verifySession.mockRejectedValue({ code }); expect(await getOperator()).toBeNull();
  });
  it("denies access on credential/configuration outages", async () => {
    mocks.admin.mockImplementation(() => { throw new Error("private credential"); });
    await expect(getOperator()).rejects.toThrow("Auth unavailable"); expect((await apiOperator() as Response).status).toBe(503);
  });
  it("rejects other providers and unverified email", async () => {
    expect(operatorFromToken({ ...token(), firebase: { sign_in_provider: "password", identities: {} } })).toBeNull();
    mocks.verifySession.mockResolvedValue({ ...token(), email_verified: false }); expect(await getOperator()).toBeNull();
  });
});
describe("session exchange and CSRF", () => {
  it("creates a seven-day secure HTTP-only cookie", async () => {
    const response = await POST(request()); expect(response.status).toBe(200);
    expect(mocks.verifyId).toHaveBeenCalledWith("id-token", true);
    expect(mocks.createSession).toHaveBeenCalledWith("id-token", { expiresIn: 604800000 });
    const cookie = response.headers.get("set-cookie")!;
    for (const flag of ["genaie_console_session=new-session", "HttpOnly", "Secure", "SameSite=lax", "Path=/", "Max-Age=604800"]) expect(cookie).toContain(flag);
    expect(cookie).not.toContain("Domain=");
  });
  it.each([301, -120, Number.NaN])("rejects a stale or invalid authentication age %s", async age => {
    mocks.verifyId.mockResolvedValue({ ...token(), auth_time: Date.now() / 1000 - age });
    expect((await POST(request())).status).toBe(401); expect(mocks.createSession).not.toHaveBeenCalled();
  });
  it.each(["auth/argument-error", "auth/invalid-id-token", "auth/id-token-expired", "auth/id-token-revoked", "auth/user-disabled"])("rejects invalid token %s", async code => {
    mocks.verifyId.mockRejectedValue({ code }); expect((await POST(request())).status).toBe(401);
  });
  it.each([{ origin: "https://attacker.example" }, { "x-csrf-token": "b".repeat(64) }, { "content-type": "text/plain" }, { "sec-fetch-site": "cross-site" }])("refuses forged requests", async headers => {
    expect((await POST(request("POST", { idToken: "id-token" }, Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined))))).status).toBe(403); expect(mocks.verifyId).not.toHaveBeenCalled();
  });
  it("rejects non-Google and unverified tokens", async () => {
    mocks.verifyId.mockResolvedValue({ ...token(), firebase: { sign_in_provider: "password" } }); expect((await POST(request())).status).toBe(401);
    mocks.verifyId.mockResolvedValue({ ...token(), email_verified: false }); expect((await POST(request())).status).toBe(401);
  });
  it("clears only this browser's session and accepts logout after expiry", async () => {
    mocks.cookie = undefined; const response = await DELETE(request("DELETE", {}));
    expect(response.status).toBe(200); expect(response.headers.get("set-cookie")).toContain("Max-Age=0"); expect(mocks.admin).not.toHaveBeenCalled();
    expect((await DELETE(request("DELETE", {}, { origin: "https://evil.example" }))).status).toBe(403);
  });
  it("issues unpredictable, noncached CSRF tokens and returns the current operator", async () => {
    const one = await csrf(), two = await csrf();
    expect((await one.json()).token).not.toBe((await two.json()).token);
    expect(one.headers.get("set-cookie")).toContain("SameSite=strict"); expect(one.headers.get("cache-control")).toBe("no-store");
    expect((await GET()).status).toBe(200);
  });
  it("handles malformed and oversized requests without issuing sessions", async () => {
    expect((await POST(request("POST", { idToken: "x".repeat(17000) }))).status).toBe(413);
    expect((await POST(request("POST", {}))).status).toBe(400); expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
describe("return path validation", () => {
  it.each(["//evil.example", "https://evil.example", "/\\evil.example", "/\nevil", "/login", "/api/auth/session", "/%2e%2e/login", "/%2e%2e//evil.example", "/.//evil.example"])("refuses %s", path => expect(safeReturnTo(path)).toBe("/"));
  it("keeps local paths and query parameters", () => expect(safeReturnTo("/campaigns/trees?q=hello%20world")).toBe("/campaigns/trees?q=hello%20world"));
});
