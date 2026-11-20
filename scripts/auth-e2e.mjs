import { spawn } from "node:child_process";
import { resolve } from "node:path";

// Firebase's standalone executable prepends its bundled Node to PATH. Keep the
// application's Node 22+ runtime for Playwright and the Next.js test server.
const runTests = process.argv[2] === "--run";
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const extra = process.argv.slice(runTests ? 3 : 2);
const env = { ...process.env };
let executable, args;
if (runTests) {
  env.PATH = env.GENAIE_E2E_ORIGINAL_PATH;
  if (env.GENAIE_E2E_PLAYWRIGHT_DEBUG) env.DEBUG = env.GENAIE_E2E_PLAYWRIGHT_DEBUG;
  delete env.GENAIE_E2E_ORIGINAL_PATH;
  delete env.GENAIE_E2E_PLAYWRIGHT_DEBUG;
  executable = process.execPath;
  args = [resolve("node_modules/@playwright/test/cli.js"), "test", ...extra];
} else {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Authentication browser tests require Node.js 22 or later.");
  env.GENAIE_E2E_ORIGINAL_PATH = process.env.PATH;
  // Firebase treats any DEBUG value as a request to log its full environment.
  // Keep Playwright diagnostics local to the actual test runner.
  if (env.DEBUG) env.GENAIE_E2E_PLAYWRIGHT_DEBUG = env.DEBUG;
  delete env.DEBUG;
  executable = "firebase";
  const command = [process.execPath, resolve("scripts/auth-e2e.mjs"), "--run", ...extra].map(quote).join(" ");
  args = ["emulators:exec", "--project", "demo-genaie-console", "--only", "auth", command];
}
const grouped = process.platform !== "win32";
const child = spawn(executable, args, { stdio: "inherit", env, detached: grouped });
child.on("error", error => { console.error(`Could not start authentication tests: ${error.message}`); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  try { if (grouped) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Child already exited. */ }
});
