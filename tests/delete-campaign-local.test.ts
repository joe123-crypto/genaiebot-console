import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const local = vi.hoisted(() => ({ checkout: "" }));
vi.mock("@/src/config", () => ({
  BOT_SOURCE: "local", BOT_API_BASE_URL: "", BOT_API_TOKEN: "", get GENAEBOT_CHECKOUT() { return local.checkout; },
  WRITE_SOURCE: "local", WRITES_ENABLED: true, BOT_WRITE_API_BASE_URL: "", BOT_WRITE_TOKEN: "",
}));
beforeEach(() => {
  local.checkout = mkdtempSync(path.join(tmpdir(), "campaign-delete-"));
  mkdirSync(path.join(local.checkout, "workspace/bin"), { recursive: true });
  vi.resetModules();
});
afterEach(() => rmSync(local.checkout, { recursive: true, force: true }));
function bridge(source: string) { writeFileSync(path.join(local.checkout, "workspace/bin/console-campaign-create"), source); }
it("uses the local stdin deletion protocol without a shell", async () => {
  bridge('import json,sys\nrequest=json.load(sys.stdin)\nassert request == {"delete":"cv","actor":"Operator"}\nprint(json.dumps({"ok":True,"slug":request["delete"],"cleanup":"pending"}))\n');
  const { deleteCampaign } = await import("@/src/lib/bot-client");
  expect(await deleteCampaign("cv", { by: "Operator" })).toMatchObject({ slug: "cv", cleanup: "pending" });
});
it("reports unreadable local acknowledgements as an unknown deletion outcome", async () => {
  bridge('import sys\nsys.stdin.read()\nprint("not json")\n');
  const { deleteCampaign } = await import("@/src/lib/bot-client");
  await expect(deleteCampaign("cv", { by: "Operator" })).rejects.toMatchObject({ detail: expect.stringContaining("may have been deleted") });
});
