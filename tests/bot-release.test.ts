import { describe, expect, it } from "vitest";
import {
  DEPLOY_DEADLINE_MS,
  VERIFY_DEADLINE_MS,
  accountsBack,
  behind,
  deployed,
  failed,
  parseBotRelease,
  parseFleet,
  pastDeadline,
  promotable,
  promote,
  startAttempt,
  type FleetRelease,
} from "@/src/domains/bot-release";

/**
 * The rules of the fleet rollout. What these pin is what decides whether a bad
 * release reaches more than one bot: what may become the target, when a bot
 * counts as behind, and what a re-run of the release job may and may not undo.
 */

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const BOT_IMAGE = `ghcr.io/joe123-crypto/genaebot:${"f".repeat(40)}`;
const A = `ghcr.io/joe123-crypto/genaebot:${SHA_A}`;
const B = `ghcr.io/joe123-crypto/genaebot:${SHA_B}`;
const NOW = Date.parse("2026-11-27T09:00:00.000Z");

const fleet = (image = A, extra: Partial<FleetRelease> = {}): FleetRelease =>
  ({ image, promotedAt: new Date(NOW).toISOString(), source: "ci", settingsGeneration: 0, ...extra });

describe("what may become the fleet's target", () => {
  it("is a commit build of the repository bots are already created from", () => {
    expect(promotable(A, BOT_IMAGE)).toBe(true);
  });

  it("is never another repository, a moving tag, or something that is not an image", () => {
    for (const image of [
      `ghcr.io/somebody-else/genaebot:${SHA_A}`,
      `ghcr.io/joe123-crypto/genaebot-fork:${SHA_A}`,
      "ghcr.io/joe123-crypto/genaebot:main",
      `ghcr.io/joe123-crypto/genaebot:${SHA_A.slice(0, 7)}`,
      `ghcr.io/joe123-crypto/genaebot:${SHA_A}@sha256:${"0".repeat(64)}`,
      "", null, 42,
    ]) expect(promotable(image, BOT_IMAGE), String(image)).toBe(false);
  });
});

describe("promoting a release", () => {
  it("clears a pause, because a later release is presumably the fix", () => {
    const paused = fleet(A, { paused: { at: "2026-11-27T08:00:00.000Z", reason: "w1 crashed", workspace: "w1" } });
    const next = promote(paused, B, "ci", NOW);
    expect(next.image).toBe(B);
    expect(next.previousImage).toBe(A);
    expect(next.paused).toBeUndefined();
  });

  it("changes nothing for the image that is already the target, pause included", () => {
    // A re-run of the CI job promotes the same image. If that cleared the pause,
    // every bot after the canary would get the release the canary just failed.
    const paused = fleet(A, { paused: { at: "2026-11-27T08:00:00.000Z", reason: "w1 crashed", workspace: "w1" } });
    expect(promote(paused, A, "ci", NOW + 60_000)).toBe(paused);
  });

  it("keeps the settings generation across releases", () => {
    expect(promote(fleet(A, { settingsGeneration: 3 }), B, "ci", NOW).settingsGeneration).toBe(3);
    expect(promote(null, A, "ci", NOW)).toMatchObject({ image: A, settingsGeneration: 0 });
  });
});

describe("whether a bot is behind", () => {
  it("is behind on another image, or below the fleet's settings", () => {
    expect(behind({ image: B, settingsGeneration: 0 }, fleet(A))).toBe(true);
    expect(behind({ image: null, settingsGeneration: 0 }, fleet(A))).toBe(true);
    expect(behind({ image: A, settingsGeneration: 0 }, fleet(A, { settingsGeneration: 1 }))).toBe(true);
    expect(behind({ image: A, settingsGeneration: 1 }, fleet(A, { settingsGeneration: 1 }))).toBe(false);
  });

  it("is not behind while its own rollout is in flight", () => {
    const attempt = startAttempt(fleet(A), { image: B, deploymentId: "d0", accounts: [] }, NOW);
    expect(behind({ image: B, settingsGeneration: 0, attempt }, fleet(A))).toBe(false);
  });

  it("is not tried again on the release it failed, only on the next one", () => {
    const attempt = failed(startAttempt(fleet(A), { image: B, deploymentId: "d0", accounts: [] }, NOW), "crashed", NOW);
    const release = { image: B, settingsGeneration: 0, attempt };
    expect(behind(release, fleet(A))).toBe(false);
    expect(behind(release, fleet(`ghcr.io/joe123-crypto/genaebot:${"c".repeat(40)}`))).toBe(true);
  });
});

describe("deadlines and verification", () => {
  it("gives a deployment 15 minutes and a restarted bot 10 more", () => {
    const attempt = startAttempt(fleet(A), { image: B, deploymentId: "d0", accounts: [] }, NOW);
    expect(pastDeadline(attempt, NOW + DEPLOY_DEADLINE_MS)).toBe(false);
    expect(pastDeadline(attempt, NOW + DEPLOY_DEADLINE_MS + 1)).toBe(true);
    const verifying = deployed(attempt, NOW + 60_000);
    expect(pastDeadline(verifying, NOW + 60_000 + VERIFY_DEADLINE_MS)).toBe(false);
    expect(pastDeadline(verifying, NOW + 60_000 + VERIFY_DEADLINE_MS + 1)).toBe(true);
  });

  it("wants every account that was connected before back, and minds no others", () => {
    expect(accountsBack(["default", "ads"], ["ads", "default", "new"])).toBe(true);
    expect(accountsBack(["default", "ads"], ["default"])).toBe(false);
    expect(accountsBack([], [])).toBe(true);
  });
});

describe("reading stored records", () => {
  it("reads a fleet back as written, and refuses one without a target", () => {
    const written = fleet(A, { previousImage: B, settingsGeneration: 2,
      paused: { at: "2026-11-27T08:00:00.000Z", reason: "w1 crashed", workspace: "w1" } });
    expect(parseFleet(JSON.parse(JSON.stringify(written)))).toEqual(written);
    expect(parseFleet({ promotedAt: "2026-11-27T08:00:00.000Z" })).toBeNull();
    expect(parseFleet({ ...written, paused: null })?.paused).toBeUndefined();
  });

  it("reads a bot that was never released to as on no known image", () => {
    expect(parseBotRelease(undefined)).toEqual({ image: null, settingsGeneration: 0 });
    const attempt = startAttempt(fleet(A), { image: B, deploymentId: "d0", accounts: ["default"] }, NOW);
    expect(parseBotRelease(JSON.parse(JSON.stringify({ image: B, settingsGeneration: 0, attempt })))).toEqual({
      image: B, settingsGeneration: 0, attempt });
  });
});
