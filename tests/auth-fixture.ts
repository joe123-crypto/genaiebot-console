import { vi } from "vitest";

export const TEST_OPERATOR = { uid: "test-operator", email: "operator@example.com", name: "Test Operator" };
export const TEST_ACTOR = "operator@example.com (test-operator)";

// Existing behavior tests run as an explicit signed-in operator. Security tests
// replace this boundary or unmock it to exercise real cookie verification.
vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/auth", () => ({
  requireOperator: vi.fn(async () => ({ uid: "test-operator", email: "operator@example.com", name: "Test Operator" })),
  getOperator: vi.fn(async () => ({ uid: "test-operator", email: "operator@example.com", name: "Test Operator" })),
  apiOperator: vi.fn(async () => ({ uid: "test-operator", email: "operator@example.com", name: "Test Operator" })),
  auditActor: (operator: { email: string; uid: string }) => `${operator.email} (${operator.uid})`,
}));

// Every existing test runs inside one workspace whose bot is https://bot.example
// with the token below. Isolation tests replace these, or import the actual
// module with vi.importActual, to exercise the resolver itself.
export const TEST_WORKSPACE = { id: "test-workspace", name: "Test workspace", ownerUid: "test-operator", bot: { baseUrl: "https://bot.example" }, onboarding: "done" as const };
export const TEST_BOT_TOKEN = "write-token";
vi.mock("@/src/lib/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/workspace")>();
  const workspace = () => ({ id: "test-workspace", name: "Test workspace", ownerUid: "test-operator", bot: { baseUrl: "https://bot.example" }, onboarding: "done" as const });
  return {
    ...actual,
    getWorkspace: vi.fn(async () => workspace()),
    requireBot: vi.fn(async () => workspace()),
    requireWorkspace: vi.fn(async () => workspace()),
    finishOnboarding: vi.fn(async () => undefined),
    holdOnboardingOpen: vi.fn(async () => undefined),
    botTarget: vi.fn(async () => ({ baseUrl: "https://bot.example", token: "write-token", workspaceId: "test-workspace" })),
  };
});
