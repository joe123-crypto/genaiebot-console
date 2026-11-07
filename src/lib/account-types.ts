/** Public, credential-free contract with genaebot's account control API. */
export type WhatsAppAccount = {
  id: string;
  number: string | null;
  enabled: boolean;
  linked: boolean | null;
  running: boolean | null;
  connected: boolean | null;
  repliesEnabled: boolean;
  startBlockedReason: string | null;
  hasError: boolean;
  pairingSessionId: string | null;
};
export type AccountsPayload = { observedAt: string; accounts: WhatsAppAccount[] };
export type LinkSession = {
  id: string;
  accountId: string;
  state: 'waiting' | 'connected' | 'expired' | 'failed';
  qrDataUrl: string | null;
  expiresAt: string;
};
export const ACCOUNT_ID = /^(?!__proto__$|constructor$|prototype$)[a-z0-9][a-z0-9_-]{0,63}$/;
