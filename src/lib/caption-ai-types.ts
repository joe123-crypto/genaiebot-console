export type CaptionChatTurn = { role: "user" | "assistant"; content: string };
/** The campaign's pictures, as the model receives them: a public asset URL for
 *  a saved campaign, or a downscaled data URL for one not yet created. */
export type CaptionAIRequest = { caption: string; prompt: string; history: CaptionChatTurn[]; images?: string[] };
export type CaptionAIReply = { message: string; suggestion?: string };
export type CaptionAIOutcome = { ok: true; reply: CaptionAIReply } | { ok: false; detail: string };
