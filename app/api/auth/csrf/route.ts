import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { CSRF_COOKIE, secureCookies } from "@/src/lib/auth-csrf";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const token = randomBytes(32).toString("hex");
    const response = NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(CSRF_COOKIE, token, { httpOnly: true, secure: secureCookies(), sameSite: "strict", path: "/", maxAge: 600 });
    return response;
  } catch { return NextResponse.json({ error: "Sign-in is not configured." }, { status: 503 }); }
}
