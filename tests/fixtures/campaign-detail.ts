import type { CampaignDetail } from "@/src/domains/campaign-detail";
import type { AdAssets, Campaign, CampaignPreview, Group, WriteCapabilities } from "@/src/lib/types";
import type { ReadResource } from "@/src/lib/read-resource";

export const slug = "borehole-drilling";
export const campaign: Campaign = {
  slug, name: "Borehole Drilling", enabled: true, storeEnabled: true, cronEnabled: true,
  cron: "0 9 * * *", hour: 9, minute: 0, timezone: "Africa/Harare", installer: "install",
  script: "/campaigns/borehole/post_ad.py", failureAlertTo: "operator", legacyNames: [], timeoutSeconds: 60,
  captions: ["Water for {ref}"], tracking: { prefix: "BH", label: "Borehole" }, images: ["borehole.jpg"],
  assets: [{ filename: "borehole.jpg", url: "https://ads.example.test/ads/borehole-drilling/aa.jpg",
             sha256: "a".repeat(64), bytes: 243016, contentType: "image/jpeg", rank: 10 }],
  targetCount: 1, weeklyCount: 0, accounts: { default: 1 }, source: "git", error: null,
};
export const preview: CampaignPreview = {
  slug, enabled: true, captions: campaign.captions, tracking: campaign.tracking,
  groups: [{ jid: "1@g.us", name: "Market One", account: "default", contactNumber: "+263000000",
    ref: "BH-ONE", variant: 0, caption: "Water for BH-ONE", cap: 4, sendsToday: true, allowedToday: [slug], weekly: [] }],
};
export const groups: Group[] = ["Market One", "New Market"].map((name, index) => ({
  jid: `${index + 1}@g.us`, name, account: "default", source: "operator", status: "active", activity: "normal",
  dailyCapOverride: null, promos: index === 0 ? [slug] : [], weekly: {}, note: null, cap: 4, replyScore: null, allowedToday: [slug],
}));
export const writes: WriteCapabilities = { enabled: true, affectsProduction: true,
  fields: { campaigns: ["captions", "enabled"], groups: ["promos", "paused_promos", "weekly"] }, delete: [] };
export const success = <T>(data: T): ReadResource<T> => ({ ok: true, data, receivedAt: "2026-11-09T00:00:00.000Z" });
export const failure = { ok: false as const, error: { detail: "Service is busy", status: 503 } };
export const adAssets: AdAssets = { mode: "r2", source: "firestore",
  fetchedAt: "2026-11-09T00:00:00Z", note: null };
export const healthy: CampaignDetail = { campaign: success(campaign), adAssets, preview: success(preview),
  membership: success({ date: "2026-11-09", disabledPromos: [], groups }), writes: success(writes) };
