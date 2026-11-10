export type CaptionChatTurn = { role: "user" | "assistant"; content: string };
export type CaptionAIRequest = { caption: string; prompt: string; history: CaptionChatTurn[] };
export type CaptionAIReply = { message: string; suggestion?: string };
export type CaptionAIOutcome = { ok: true; reply: CaptionAIReply } | { ok: false; detail: string };
