/** Optional, curated metadata understood by both old and new bot adapters. */
export type BotErrorMetadata = {
  code?: "config_rate_limited";
  upstreamStatus?: number;
  quota?: "daily" | "rate" | "unknown";
  retryAfterSeconds?: number;
};

export function botErrorMetadata(value: unknown): BotErrorMetadata {
  if (!value || typeof value !== "object") return {};
  const body = value as Record<string, unknown>;
  const result: BotErrorMetadata = {};
  if (body.code === "config_rate_limited") result.code = body.code;
  if (Number.isInteger(body.upstreamStatus) && Number(body.upstreamStatus) >= 100 && Number(body.upstreamStatus) <= 599) {
    result.upstreamStatus = Number(body.upstreamStatus);
  }
  if (body.quota === "daily" || body.quota === "rate" || body.quota === "unknown") result.quota = body.quota;
  if (typeof body.retryAfterSeconds === "number" && Number.isFinite(body.retryAfterSeconds) &&
      body.retryAfterSeconds >= 0 && body.retryAfterSeconds <= 86400) {
    result.retryAfterSeconds = body.retryAfterSeconds;
  }
  return result;
}
