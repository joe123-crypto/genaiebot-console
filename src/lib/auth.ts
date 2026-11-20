import "server-only";
import { cache } from "react";
import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { DecodedIdToken } from "firebase-admin/auth";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { firebaseAdminAuth, AuthUnavailableError } from "./firebase-admin";
import { safeReturnTo, type Operator } from "./auth-types";

export { AuthUnavailableError };
export function operatorFromToken(token: DecodedIdToken): Operator | null {
  if (token.firebase?.sign_in_provider !== "google.com" || token.email_verified !== true || !token.email || !token.uid) return null;
  return { uid: token.uid, email: token.email, name: typeof token.name === "string" && token.name.trim() ? token.name : token.email };
}
const invalidCodes = new Set(["auth/argument-error", "auth/invalid-argument", "auth/invalid-session-cookie", "auth/session-cookie-expired", "auth/session-cookie-revoked", "auth/user-disabled", "auth/user-not-found", "auth/invalid-id-token", "auth/id-token-expired", "auth/id-token-revoked"]);
export function isInvalidCredential(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && invalidCodes.has(String(error.code));
}
/** React cache is request-scoped; never share a verified identity across requests. */
export const getOperator = cache(async (): Promise<Operator | null> => {
  const session = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!session) return null;
  try { return operatorFromToken(await firebaseAdminAuth().verifySessionCookie(session, true)); }
  catch (error) { if (isInvalidCredential(error)) return null; throw new AuthUnavailableError(); }
});
export async function requireOperator(returnTo?: string): Promise<Operator> {
  const operator = await getOperator();
  if (!operator) {
    const path = returnTo ?? (await headers()).get("x-genaie-return-to") ?? "/";
    redirect(`/login?returnTo=${encodeURIComponent(safeReturnTo(path))}`);
  }
  return operator;
}
export function auditActor(operator: Operator): string {
  const full = `${operator.email} (${operator.uid})`;
  // The existing Customer Bot API caps actor strings at 120 characters. Keep
  // the full UID when possible; unusually long/imported UIDs use a stable hash.
  if (Array.from(full).length <= 120 && !/[\x00-\x1f\x7f]/.test(full)) return full;
  const uid = operator.uid.length <= 80 && /^[\x21-\x7e]+$/.test(operator.uid)
    ? operator.uid : `uid-sha256:${createHash("sha256").update(operator.uid).digest("hex")}`;
  const suffix = ` (${uid})`;
  const email = Array.from(operator.email.replace(/[\x00-\x1f\x7f]/g, ""));
  return `${email.slice(0, 119 - suffix.length).join("")}…${suffix}`;
}
export async function apiOperator(): Promise<Operator | Response> {
  try {
    const operator = await getOperator();
    return operator ?? Response.json({ error: "Sign in to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Sign-in is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
