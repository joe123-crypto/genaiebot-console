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
