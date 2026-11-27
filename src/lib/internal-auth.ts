import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The bearer check for routes called by automation, never by a browser: the
 * fleet's release and tick. Each has a token of its own in the environment, so
 * the CI job that may promote a release cannot also drive the rollout, and
 * neither can do anything a signed-in user can.
 *
 * A token shorter than 32 characters counts as not set, so a placeholder can
 * never open the route. Both sides are hashed before they are compared, which
 * makes the comparison constant-time whatever their lengths.
 */
export const MIN_INTERNAL_TOKEN_LENGTH = 32;

export function bearerMatches(request: Request | undefined, name: string): boolean {
  const expected = process.env[name]?.trim() ?? "";
  if (expected.length < MIN_INTERNAL_TOKEN_LENGTH) return false;
  const header = request?.headers?.get("authorization") ?? "";
  const presented = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(presented), digest(expected));
}
