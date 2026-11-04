import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The console reads JSON from a bridge it does not version-lock, so the real
 * risk is not a missing payload but an outdated one: the screens read a missing
 * `enabled` as `undefined`, which is falsy, which means "switched off". Left
 * unchecked that renders every campaign dead and an empty schedule, with no
 * error anywhere. These tests pin the refusal.
 */

async function loadWith(source: "local" | "remote") {
  vi.resetModules();
  vi.doMock("@/src/config", () => ({
    BOT_SOURCE: source,
    BOT_API_BASE_URL: source === "remote" ? "https://bot.example" : "",
    BOT_API_TOKEN: "",
    GENAEBOT_CHECKOUT: "/checkout",
  }));
  return import("@/src/lib/bot-client");
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/src/config");
});

const live = { slug: "genaie", enabled: true };

/** The screens render `detail`, not `message` — that is the text an operator
 *  actually sees on the BotError card, so that is what these assert on. */
function detailOf(fn: () => void) {
  try {
    fn();
  } catch (error) {
    return (error as { detail?: string }).detail ?? String(error);
  }
  throw new Error("expected a refusal, got none");
}

describe("checkShape", () => {
  it("accepts a payload that carries everything the screens read", async () => {
    const { checkShape } = await loadWith("remote");
    expect(() => checkShape("overview", { campaigns: [live] })).not.toThrow();
    expect(() => checkShape("campaigns", { campaigns: [live] })).not.toThrow();
    expect(() => checkShape("groups", { disabledPromos: [], groups: [] })).not.toThrow();
    expect(() => checkShape("preview/cv", { enabled: false })).not.toThrow();
  });

  it("refuses campaigns with no enabled flag rather than reading them as off", async () => {
    const { checkShape, BotUnavailableError } = await loadWith("remote");
    expect(() => checkShape("campaigns", { campaigns: [{ slug: "cv" }] })).toThrow(
      BotUnavailableError,
    );
  });

  it("names the campaign it could not read", async () => {
    const { checkShape } = await loadWith("remote");
    expect(detailOf(() => checkShape("overview", { campaigns: [live, { slug: "cv" }] })))
      .toMatch(/cv/);
  });

  it("refuses a groups payload with no disabledPromos", async () => {
    const { checkShape } = await loadWith("remote");
    expect(detailOf(() => checkShape("groups", { groups: [] }))).toMatch(/disabledPromos/);
  });

  it("refuses a preview that cannot say whether the campaign is on", async () => {
    const { checkShape } = await loadWith("remote");
    expect(detailOf(() => checkShape("preview/cv", { captions: [] }))).toMatch(/enabled/);
  });

  it("tells a local reader to update the checkout", async () => {
    const { checkShape } = await loadWith("local");
    expect(detailOf(() => checkShape("groups", {}))).toMatch(/pull --ff-only/);
  });

  it("tells a remote reader to redeploy the gateway instead", async () => {
    const { checkShape } = await loadWith("remote");
    expect(detailOf(() => checkShape("groups", {}))).toMatch(/redeploy the gateway/);
  });

  it("says nothing about routes it does not police", async () => {
    const { checkShape } = await loadWith("remote");
    expect(() => checkShape("something-else", {})).not.toThrow();
  });
});
