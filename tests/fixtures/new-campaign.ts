import type { NewCampaign } from "@/src/domains/campaign-create";
export function validCampaign(): NewCampaign {
  return { requestId: "12345678-1234-1234-1234-123456789abc", slug: "demo", name: "Demo", enabled: false,
    captions: ["Hello {bot_number}"], images: [{ filename: "one.png", sha256: "a".repeat(64), key: `ads/demo/${"a".repeat(64)}.png`, bytes: 100, contentType: "image/png" }],
    schedule: { time: "10:00", timezone: "Africa/Harare", weekdays: [0, 1, 2, 3, 4, 5, 6] }, groups: [{ jid: "1@g.us" }] };
}
