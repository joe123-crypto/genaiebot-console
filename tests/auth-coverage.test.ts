/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireOperator, apiOperator } from "@/src/lib/auth";
const pages = import.meta.glob("../app/**/page.tsx");
const actions = import.meta.glob(["../app/**/actions.ts", "../app/**/caption-ai-actions.ts"]);
const apis = import.meta.glob("../app/api/**/route.ts");
const denied = new Error("AUTH_REQUIRED");
const fetchSpy = vi.fn(() => { throw new Error("Protected network operation"); });
beforeEach(() => {
  fetchSpy.mockClear(); vi.stubGlobal("fetch", fetchSpy);
  vi.mocked(requireOperator).mockRejectedValue(denied);
  vi.mocked(apiOperator).mockImplementation(async () => Response.json({ error: "Sign in" }, { status: 401 }));
});
afterEach(() => { expect(fetchSpy).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
describe("every console entrypoint denies unauthenticated requests", () => {
  for (const [path, load] of Object.entries(pages)) {
    if (path.includes("/login/")) continue;
    it(`protects page ${path} before reading input or data`, async () => {
      const module = await load() as { default: (...args: unknown[]) => unknown };
      await expect(module.default({})).rejects.toBe(denied);
    });
  }
  for (const [path, load] of Object.entries(actions)) {
    it(`protects all exported actions in ${path}`, async () => {
      const module = await load() as Record<string, (...args: unknown[]) => unknown>;
      for (const action of Object.values(module)) if (typeof action === "function") await expect(action()).rejects.toBe(denied);
    });
  }
  for (const [path, load] of Object.entries(apis)) {
    if (path.includes("/auth/")) continue;
    it(`protects every handler in ${path}`, async () => {
      const module = await load() as Record<string, (...args: unknown[]) => Promise<Response>>;
      for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"]) if (module[method]) expect((await module[method](undefined, {})).status).toBe(401);
    });
  }
});
