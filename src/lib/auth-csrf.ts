import "server-only";
import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { appOrigin } from "./firebase-admin";

export const CSRF_COOKIE = "genaie_console_csrf";
export function secureCookies(): boolean { return appOrigin().startsWith("https:"); }
/** The session cookie's shape. One definition, so the routes that set it and
 *  the routes that clear it cannot drift apart and leave a cookie behind. */
export function sessionCookieOptions() {
  return { httpOnly: true, secure: secureCookies(), sameSite: "lax" as const, path: "/" };
}
export async function validAuthMutation(request: Request): Promise<boolean> {
  if (request.headers.get("origin") !== appOrigin() || request.headers.get("sec-fetch-site") === "cross-site" ||
      request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return false;
  const token = request.headers.get("x-csrf-token") || "";
  const cookie = (await cookies()).get(CSRF_COOKIE)?.value || "";
  return /^[a-f0-9]{64}$/.test(token) && /^[a-f0-9]{64}$/.test(cookie) && timingSafeEqual(Buffer.from(token), Buffer.from(cookie));
}
