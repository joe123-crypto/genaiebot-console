import { NextResponse, type NextRequest } from "next/server";

/** Carries a trustworthy local return path; session verification stays in Node.js. */
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-genaie-return-to", request.nextUrl.pathname + request.nextUrl.search);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|logo.png).*)"] };
