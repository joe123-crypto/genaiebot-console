// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { SessionBoundary } from "@/app/_components/session-boundary";
import { AUTH_UID_KEY, authFetch, authMutation, clearConsoleDrafts } from "@/src/lib/auth-browser";

const draftKey = "genaie:caption-editor:v1:campaign:0";
const groupKey = "genaie:campaign-groups:v1:campaign";
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ operator: { uid: "one" } })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("browser identity and drafts", () => {
  it("clears the previous user's drafts before mounting editors", async () => {
    localStorage.setItem(AUTH_UID_KEY, "old-user"); sessionStorage.setItem(draftKey, "old draft"); localStorage.setItem(groupKey, "old groups");
    const readDraft = vi.fn();
    function Editor() { useEffect(() => { readDraft(sessionStorage.getItem(draftKey), localStorage.getItem(groupKey)); }, []); return <span>Editor</span>; }
    render(<SessionBoundary uid="one"><Editor /></SessionBoundary>);
    await screen.findByText("Editor"); expect(readDraft).toHaveBeenCalledWith(null, null);
    expect(sessionStorage.getItem(AUTH_UID_KEY)).toBe("one");
  });
  it("retains same-user drafts after reauthentication", async () => {
    for (const storage of [sessionStorage, localStorage]) storage.setItem(AUTH_UID_KEY, "one");
    sessionStorage.setItem(draftKey, "same-user draft"); localStorage.setItem(groupKey, "same-user groups");
    render(<SessionBoundary uid="one"><span>Editor</span></SessionBoundary>); await screen.findByText("Editor");
    expect(sessionStorage.getItem(draftKey)).toBe("same-user draft"); expect(localStorage.getItem(groupKey)).toBe("same-user groups");
  });
  it("preserves the same user's shared group draft when opening another tab", async () => {
    localStorage.setItem(AUTH_UID_KEY, "one"); localStorage.setItem(groupKey, "shared draft");
    render(<SessionBoundary uid="one"><span>Editor</span></SessionBoundary>); await screen.findByText("Editor");
    expect(localStorage.getItem(groupKey)).toBe("shared draft");
  });
  it("adopts drafts with no recorded owner on the first signed-in load", async () => {
    sessionStorage.setItem(draftKey, "pre-sign-in draft"); localStorage.setItem(groupKey, "pre-sign-in groups");
    render(<SessionBoundary uid="one"><span>Editor</span></SessionBoundary>); await screen.findByText("Editor");
    expect(sessionStorage.getItem(draftKey)).toBe("pre-sign-in draft"); expect(localStorage.getItem(groupKey)).toBe("pre-sign-in groups");
    for (const storage of [sessionStorage, localStorage]) expect(storage.getItem(AUTH_UID_KEY)).toBe("one");
  });
  it("clears another user's tab drafts even when this browser's owner is unknown", async () => {
    sessionStorage.setItem(AUTH_UID_KEY, "old-user"); sessionStorage.setItem(draftKey, "old draft");
    render(<SessionBoundary uid="one"><span>Editor</span></SessionBoundary>); await screen.findByText("Editor");
    expect(sessionStorage.getItem(draftKey)).toBeNull();
  });
  it("clears console drafts without deleting unrelated browser data", () => {
    for (const storage of [sessionStorage, localStorage]) { storage.setItem(draftKey, "draft"); storage.setItem("unrelated", "keep"); }
    clearConsoleDrafts();
    for (const storage of [sessionStorage, localStorage]) { expect(storage.getItem(draftKey)).toBeNull(); expect(storage.getItem("unrelated")).toBe("keep"); }
  });
  it("deletes stored campaign pictures only when every draft is cleared", () => {
    const deleteDatabase = vi.fn(); vi.stubGlobal("indexedDB", { deleteDatabase });
    clearConsoleDrafts("session"); expect(deleteDatabase).not.toHaveBeenCalled();
    clearConsoleDrafts(); expect(deleteDatabase).toHaveBeenCalledExactlyOnceWith("genaie-campaign-create");
  });
  it("reroutes expired API sessions without treating failures as bot outages", async () => {
    const replace = vi.fn(); vi.stubGlobal("window", { location: { pathname: "/campaigns", search: "?q=trees", replace } });
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: "Sign in" }, { status: 401 }));
    await expect(authFetch("/api/live/campaigns")).rejects.toThrow("Your session ended");
    expect(replace).toHaveBeenCalledWith("/login?returnTo=%2Fcampaigns%3Fq%3Dtrees");
  });
  it("fetches a CSRF token before mutating the session", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ token: "csrf-token" })).mockResolvedValueOnce(Response.json({ ok: true }));
    await authMutation("DELETE");
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/auth/session", expect.objectContaining({ method: "DELETE", headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf-token" } }));
  });
  it("carries the same token to another route that checks the pair", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ token: "csrf-token" })).mockResolvedValueOnce(Response.json({ ok: true }));
    await authMutation("DELETE", {}, "/api/workspace");
    expect(fetch).toHaveBeenNthCalledWith(1, "/api/auth/csrf", { cache: "no-store" });
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/workspace", expect.objectContaining({ method: "DELETE", headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf-token" } }));
  });
  it("reports the reason a route refused rather than a generic failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ token: "csrf-token" }))
      .mockResolvedValueOnce(Response.json({ error: "Your data was deleted, but your sign-in could not be." }, { status: 503 }));
    await expect(authMutation("DELETE", {}, "/api/workspace")).rejects.toThrow("your sign-in could not be");
  });
});
