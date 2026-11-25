import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_MAX_AGE_SECONDS } from "@/src/config";
import { apiOperator, isInvalidCredential, operatorFromToken } from "@/src/lib/auth";
import { firebaseAdminAuth } from "@/src/lib/firebase-admin";
import { validAuthMutation, sessionCookieOptions } from "@/src/lib/auth-csrf";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function tokenBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length")) > 16384) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function GET() {
  const operator = await apiOperator();
  return operator instanceof Response ? operator : json({ operator });
}
export async function POST(request: Request) {
  try {
    if (!await validAuthMutation(request)) return json({ error: "Invalid sign-in request. Reload and try again." }, 403);
    const raw = await tokenBody(request);
    if (raw === null) return json({ error: "Request too large." }, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json({ error: "Expected a sign-in token." }, 400); }
    if (!body || typeof body !== "object" || !("idToken" in body) || typeof body.idToken !== "string" || !body.idToken) return json({ error: "Expected a sign-in token." }, 400);
    const auth = firebaseAdminAuth();
    const decoded = await auth.verifyIdToken(body.idToken, true);
    const operator = operatorFromToken(decoded);
    const age = Date.now() / 1000 - decoded.auth_time;
    if (!operator || !Number.isFinite(age) || age < -60 || age > 300) return json({ error: "Please sign in again with Google." }, 401);
    const session = await auth.createSessionCookie(body.idToken, { expiresIn: SESSION_COOKIE_MAX_AGE_SECONDS * 1000 });
    const response = json({ operator });
    response.cookies.set(SESSION_COOKIE_NAME, session, { ...sessionCookieOptions(), maxAge: SESSION_COOKIE_MAX_AGE_SECONDS });
    return response;
  } catch (error) { return isInvalidCredential(error) ? json({ error: "Please sign in again with Google." }, 401) : json({ error: "Sign-in is temporarily unavailable. Please try again." }, 503); }
}
export async function DELETE(request: Request) {
  try {
    if (!await validAuthMutation(request)) return json({ error: "Invalid sign-out request. Reload and try again." }, 403);
    const response = json({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, "", { ...sessionCookieOptions(), maxAge: 0 });
    return response;
  } catch { return json({ error: "Sign-out is temporarily unavailable." }, 503); }
}
