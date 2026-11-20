export type Operator = { uid: string; email: string; name: string };

/** Only navigate within this application, including after a session expires. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20\x7f]/.test(value)) return "/";
  const url = new URL(value, "https://console.invalid");
  if (url.origin !== "https://console.invalid" || url.pathname.startsWith("//") || url.pathname === "/login" || url.pathname.startsWith("/api/")) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
