import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), finish: vi.fn(), operator: vi.fn() }));
vi.mock("@/app/campaigns/new/actions", () => ({ createCampaignAction: mocks.create }));
vi.mock("@/src/lib/workspace", () => ({ finishOnboarding: mocks.finish }));
vi.mock("@/src/lib/auth", () => ({ requireOperator: mocks.operator }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { createOnboardingCampaignAction } from "@/app/onboarding/actions";

/** The wizard's last step ends onboarding in the same request that saves the campaign. */

const input = { slug: "sale" } as never;

beforeEach(() => { vi.clearAllMocks(); mocks.finish.mockResolvedValue(undefined); });

describe("createOnboardingCampaignAction", () => {
  it.each(["ready", "pending"] as const)("ends onboarding once the campaign is saved (schedule %s)", async (scheduling) => {
    const saved = { ok: true, slug: "sale", scheduling };
    mocks.create.mockResolvedValue(saved);
    await expect(createOnboardingCampaignAction(input)).resolves.toEqual(saved);
    expect(mocks.create).toHaveBeenCalledWith(input);
    expect(mocks.finish).toHaveBeenCalledWith("done");
    expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.finish.mock.invocationCallOrder[0]);
  });

  it("leaves onboarding open when the campaign was not saved", async () => {
    const refused = { ok: false, detail: "No.", outcome: "not-created" };
    mocks.create.mockResolvedValue(refused);
    await expect(createOnboardingCampaignAction(input)).resolves.toEqual(refused);
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it("fails the request when the end cannot be recorded, so the step's retry records it", async () => {
    mocks.create.mockResolvedValue({ ok: true, slug: "sale", scheduling: "ready" });
    mocks.finish.mockRejectedValue(new Error("Firestore is unavailable."));
    await expect(createOnboardingCampaignAction(input)).rejects.toThrow("Firestore is unavailable.");
  });
});
