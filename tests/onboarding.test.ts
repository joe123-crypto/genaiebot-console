import { describe, expect, it } from "vitest";
import { furthestStep, onboardingStep, stepOpen } from "@/src/domains/onboarding";

describe("onboarding steps", () => {
  it("sends each workspace to the first step it has not done", () => {
    expect(onboardingStep({ hasBot: false, connectedLines: 0 })).toBe("bot");
    expect(onboardingStep({ hasBot: true, connectedLines: 0 })).toBe("whatsapp");
    expect(onboardingStep({ hasBot: true, connectedLines: null })).toBe("whatsapp");
    expect(onboardingStep({ hasBot: true, connectedLines: 2 })).toBe("campaign");
  });

  it("never opens a step ahead of what the workspace has", () => {
    expect(stepOpen("whatsapp", { hasBot: false, connectedLines: 0 })).toBe(false);
    expect(stepOpen("campaign", { hasBot: true, connectedLines: 0 })).toBe(false);
    expect(stepOpen("bot", { hasBot: true, connectedLines: 1 })).toBe(true);
    expect(stepOpen("whatsapp", { hasBot: true, connectedLines: 1 })).toBe(true);
  });

  it("does not throw anyone off the campaign step because the bot could not say", () => {
    expect(furthestStep({ hasBot: true, connectedLines: null })).toBe("campaign");
    expect(stepOpen("campaign", { hasBot: true, connectedLines: null })).toBe(true);
  });
});
