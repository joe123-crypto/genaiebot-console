import { describe, expect, it } from "vitest";
import { BotUnavailableError, WriteRefusedError } from "@/src/lib/bot-client";
import { botErrorMetadata } from "@/src/lib/bot-error-metadata";
import { CONFIG_RATE_LIMITED_MESSAGE, failedWrite } from "@/src/lib/write-outcome";

describe("quota write outcomes", () => {
  it("explains a definite 429 refusal and preserves curated metadata", () => {
    const metadata = { code: "config_rate_limited", upstreamStatus: 429, quota: "daily", retryAfterSeconds: 300 } as const;
    expect(failedWrite(new WriteRefusedError("cannot read config", [], 503, metadata))).toEqual({
      ok: false, detail: CONFIG_RATE_LIMITED_MESSAGE, ...metadata,
    });
  });

  it("recognizes older bots' exact config-read refusal", () => {
    const detail = "cannot read the current config, so nothing was changed: firestore.googleapis.com answered HTTP 429";
    expect(failedWrite(new WriteRefusedError(detail, [], 503))).toEqual({
      ok: false, detail: CONFIG_RATE_LIMITED_MESSAGE, code: "config_rate_limited",
    });
  });

  it("never presents a timeout or unrelated failure as definitely unsaved", () => {
    for (const detail of ["config/groups/x did not answer within 30s — the change may still have been made", "upstream returned 429"]) {
      expect(failedWrite(new BotUnavailableError(detail))).toEqual({ ok: false, detail });
    }
  });

  it("drops malformed metadata and arbitrary upstream details", () => {
    expect(botErrorMetadata({ code: "secret", quota: "secret", upstreamStatus: "429", retryAfterSeconds: Infinity, token: "secret" })).toEqual({});
    expect(botErrorMetadata({ retryAfterSeconds: -1 })).toEqual({});
  });
});
