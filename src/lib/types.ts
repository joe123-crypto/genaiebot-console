/** Shapes the console reads. They mirror genaebot's own vocabulary exactly:
 *  a group's `status` gates generation, `promos` is intent kept even while
 *  paused, and `account` names the WhatsApp line that posts there. */

export type GroupStatus = "active" | "on-hold" | "admin-only" | "not-a-member";
export type ActivityTier = "busy" | "normal" | "quiet";
export type GroupSource = "whatsapp" | "operator" | "git" | null;

export type Group = {
  jid: string;
  name: string | null;
  source: GroupSource;
  status: GroupStatus;
  activity: ActivityTier;
  account: string;
  dailyCapOverride: number | null;
  promos: string[];
  weekly: Record<string, string[]>;
  note: string | null;
  cap: number | null;
  replyScore: number | null;
  allowedToday: string[];
};

export type Tracking = {
  prefix?: string;
  label?: string;
  number?: string;
  prefill?: string;
  link_line?: string;
};

export type Campaign = {
  slug: string;
  name: string;
  cron: string;
  hour: number | null;
  minute: number | null;
  timezone: string;
  installer: string;
  script: string;
  failureAlertTo: string;
  legacyNames: string[];
  timeoutSeconds: number;
  captions: string[];
  tracking: Tracking;
  images: string[];
  targetCount: number;
  weeklyCount: number;
  accounts: Record<string, number>;
  source: "git" | "console";
  error: string | null;
};

export type LineAccount = {
  id: string;
  number: string;
  isContact: boolean;
};

export type Overview = {
  date: string;
  groupsByStatus: Partial<Record<GroupStatus, number>>;
  groupTotal: number;
  campaignTotal: number;
  plannedSendsToday: number;
  accounts: LineAccount[];
  capsEnabled: boolean;
  campaigns: Campaign[];
};

export type PreviewRow = {
  jid: string;
  name: string | null;
  account: string;
  contactNumber: string | null;
  ref: string | null;
  variant: number | null;
  caption: string | null;
  cap: number | null;
  sendsToday: boolean;
  allowedToday: string[];
  weekly: string[];
};

export type CampaignPreview = {
  slug: string;
  captions: string[];
  tracking: Tracking;
  groups: PreviewRow[];
};
