import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { apiOperator } from "@/src/lib/auth";
import { AccountDeletionError, deleteAccount } from "@/src/lib/account-deletion";
import { sessionCookieOptions, validAuthMutation } from "@/src/lib/auth-csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deleting the signed-in user's account: their workspace, its data and their
 * sign-in. Named for the workspace rather than the account because `accounts`
 * already means WhatsApp accounts everywhere else under `/api`.
 *
 * Whose account is never asked for, so there is no body and nothing to parse.
 * The session says who, and `validAuthMutation` is the same origin and CSRF
 * pair the sign-out beside it checks: a session alone does not authorize a
 * cross-site submission, least of all this one.
 */

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function DELETE(request: Request) {
  const operator = await apiOperator();
  if (operator instanceof Response) return operator;
  try {
    if (!await validAuthMutation(request)) return json({ error: "Invalid request. Reload and try again." }, 403);
    await deleteAccount(operator);
  } catch (error) {
    return json({ error: error instanceof AccountDeletionError ? error.message
      : "Your account could not be deleted. Try again shortly." }, 503);
  }
  // The account is gone, so this browser's session is meaningless. Cleared
  // here rather than left for the next request to find unverifiable.
  const response = json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", { ...sessionCookieOptions(), maxAge: 0 });
  return response;
}
