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
  /** False when the manifest switches the campaign off: it is still declared
   *  and still has copy, but installs no cron and so never posts. */
  enabled: boolean;
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

/**
 * Phase 2 of genaebot's move off membership.json: whether a run also reads
 * Firestore and compares the two, and what the newest comparison found. The
 * bridge has served this since the shadow landed; the console ignored it,
 * which meant the drift signal the bot deliberately surfaces reached nobody.
 */
export type ShadowCheck = {
  checkedAt: string;
  /** `exact` from a snapshot proves less than `exact` from a live read, which
   *  is why `source` is reported beside the status rather than folded into it. */
  status: "exact" | "drift" | "unavailable" | "error";
  source: "firestore" | "snapshot" | null;
  degraded: string | null;
  problems: string[];
  notes: string[];
};

export type ConfigShadow = {
  /** `file` is today's behaviour; `shadow` also reads Firestore and compares. */
  mode: string;
  /** Set when GENAIE_CONFIG_SOURCE asked for something not honoured yet. */
  warning: string | null;
  lastCheck: ShadowCheck | null;
};

export type Overview = {
  date: string;
  groupsByStatus: Partial<Record<GroupStatus, number>>;
  groupTotal: number;
  campaignTotal: number;
  plannedSendsToday: number;
  accounts: LineAccount[];
  capsEnabled: boolean;
  /** Absent from a bridge older than the shadow work, so optional: this one is
   *  safe to miss, unlike `enabled`, because nothing reads it as a decision. */
  configShadow?: ConfigShadow;
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
  enabled: boolean;
  captions: string[];
  tracking: Tracking;
  groups: PreviewRow[];
};

/** The groups payload carries the switched-off campaigns alongside the rows,
 *  so a screen can tell "this campaign is off" from "today's cap held it back"
 *  without also fetching the campaigns route. */
export type GroupsPayload = {
  date: string;
  disabledPromos: string[];
  groups: Group[];
  /** Optional for compatibility with bot versions before automatic discovery. */
  discoveredGroups?: DiscoveredGroup[];
  groupDiscovery?: GroupDiscovery;
};

export type DiscoveredGroup = {
  jid: string;
  name: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  accounts: { accountId: string; firstSeenAt: string; lastSeenAt: string }[];
};

export type GroupDiscovery = {
  enabled: boolean;
  accounts: {
    accountId: string;
    status: "waiting" | "ok" | "stale" | "error" | "disabled";
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
  }[];
};
