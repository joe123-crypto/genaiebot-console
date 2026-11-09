/** Shapes the console reads. They mirror genaebot's own vocabulary exactly:
 *  a group's `status` gates generation, `promos` is intent kept even while
 *  paused, and `account` names the WhatsApp line that posts there. */

export type GroupStatus = "active" | "on-hold" | "admin-only" | "not-a-member";
export type ActivityTier = "busy" | "normal" | "quiet";
export type GroupSource = "whatsapp" | "operator" | "git" | null;

/** Observations only: these never drive targeting or advertising caps. */
export type GroupMetrics = {
  dailyMessageCount: number | null;
  windowStart: string;
  asOf: string;
  coverage: "complete" | "partial" | "unavailable";
  memberCount: number | null;
  memberCountObservedAt: string | null;
};

export type Group = {
  jid: string;
  name: string | null;
  source: GroupSource;
  status: GroupStatus;
  activity: ActivityTier;
  account: string;
  dailyCapOverride: number | null;
  promos: string[];
  /** Campaigns this group stays assigned to but is paused for: they neither post
   *  to it nor take one of its daily cap turns. Absent from an older bot. */
  pausedPromos?: string[];
  weekly: Record<string, string[]>;
  note: string | null;
  cap: number | null;
  replyScore: number | null;
  allowedToday: string[];
  /** Absent on bot versions before group telemetry. */
  metrics?: GroupMetrics;
};

export type Tracking = {
  prefix?: string;
  label?: string;
  number?: string;
  prefill?: string;
  link_line?: string;
};

/**
 * One picture of a campaign's, as the bot's asset index reports it.
 *
 * `url` is absent when the bot has no address configured to serve the bytes
 * from: the index still names the picture, which is a different thing from the
 * campaign having none, so the tile says so rather than disappearing.
 */
export type CampaignAsset = {
  filename: string;
  url?: string | null;
  sha256: string;
  bytes: number;
  contentType: string;
  rank: number | null;
};

/** Where the pictures come from, and whether anything could be read. Reported
 *  once per payload rather than per campaign: a failed index read is one fact
 *  about the bot, not ten facts about ten campaigns. */
export type AdAssets = {
  /** What a RUN attaches today: `repo` is the copy baked into the bot's
   *  container, `r2` the one the index names. They are the same bytes while
   *  the index matches the checkout, which is what `lastCheck` compares. */
  mode: string;
  source: "firestore" | "snapshot" | null;
  fetchedAt: string | null;
  /** Why there are no pictures, when there are none. Shown verbatim: it is the
   *  bot's own account of what it could not read. */
  note: string | null;
};

export type Campaign = {
  slug: string;
  name: string;
  /** Whether the campaign actually posts: on only if both switches below are.
   *  False when either is off -- it is still declared and still has copy. */
  enabled: boolean;
  /** The operator's own switch in Firestore, and the one a toggle edits. */
  storeEnabled?: boolean;
  /** Whether the manifest registers a cron at all. Read-only here: no toggle can
   *  create a cron, so a screen must not pretend one can. Both absent from a bot
   *  older than the console's config writes. */
  cronEnabled?: boolean;
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
  /** The basenames the campaign's own `post_ad.py` declares, in the order the
   *  bot rotates them. Still the list a screen shows. */
  images: string[];
  /** What the bot's asset index says those pictures are, joined to `images` by
   *  filename. Absent from a bot older than the index read, which reads as "no
   *  preview" and never as "no pictures". */
  assets?: CampaignAsset[];
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

/**
 * What the bot will accept from the console, reported by the writer itself so a
 * screen cannot offer an edit the bot is going to refuse. `fields` and `delete`
 * are its `EDITABLE` / `DELETABLE` verbatim.
 */
export type WriteCapabilities = {
  /** Whether the bot's console API holds a write key at all. */
  enabled: boolean;
  /** Whether a saved change reaches the campaigns. False before the Firestore
   *  cutover: a write would land in the store while runs still read the file. */
  affectsProduction: boolean;
  fields: Record<string, string[]>;
  delete: string[];
};

/** The settings every group's daily allowance derives from, in the shape a
 *  form edits them. */
export type CapSettings = {
  enabled: boolean;
  defaultActivity: string;
  bands: Record<string, [number, number]>;
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
  /** Absent from a bot older than the console's config writes. That is read as
   *  "this bot cannot be written to", never as "everything is writable". */
  writes?: WriteCapabilities;
  capSettings?: CapSettings;
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
  /** Still assigned, but paused for this campaign. The row is listed anyway --
   *  this is where a pause is resumed from -- and `sendsToday` is false. */
  paused?: boolean;
  sendsToday: boolean;
  allowedToday: string[];
  weekly: string[];
};

/** What the bot reports after a config write (or a dry run of one). */
export type WriteResult = {
  collection: string;
  id: string;
  change: "created" | "updated" | "unchanged" | "deleted";
  fields: string[];
  warnings: string[];
  /** The audit document the change was committed with; null for a dry run or a
   *  change that changed nothing. */
  audit: string | null;
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
  metrics?: GroupMetrics;
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
