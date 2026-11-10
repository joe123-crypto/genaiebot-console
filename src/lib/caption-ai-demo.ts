export type CaptionDemoReply = { message: string; suggestion?: string };

// Frontend demo only. Keep the adapter separate so a real AI service can
// replace it without changing the editor or applying suggestions implicitly.
export async function demoCaptionReply(prompt: string, caption: string): Promise<CaptionDemoReply> {
  await new Promise((resolve) => setTimeout(resolve, 450));
  if (!caption.trim()) return { message: "Write a caption first, then I can suggest a shorter version, a professional tone, or a clearer call to action." };
  if (/(?:price|cost|number|address|date|translate|translation|language|replace|\d|\$)/i.test(prompt)) {
    return { message: "This demo supports shortening, professional tone, and calls to action. Edit factual details manually; a connected AI service will support more requests." };
  }
  if (/short|concise|compact|trim|brief/i.test(prompt)) {
    const suggestion = caption.split("\n").map((line) => line.trim()).filter(Boolean).join("\n")
      .replace(/\bWe are pleased to (?:let you know|announce) that\s+/gi, "")
      .replace(/\bin order to\b/gi, "to");
    return { message: suggestion === caption
      ? "This caption is already compact. I’ve kept the details intact in the suggestion below."
      : "Here’s a more compact layout, keeping your details and template placeholders.", suggestion };
  }
  if (/professional|formal|polish|business|tone/i.test(prompt)) {
    let suggestion = caption.split("\n").map((line) => line.replace(/^\s*(?:\p{Extended_Pictographic}[\uFE0F\u200D\s]*)+/u, "")).join("\n")
      .replace(/^Hey (?:everyone|folks)[!,]?/i, "Hello,");
    if (suggestion === caption) suggestion = `Please see the details below.\n\n${caption}`;
    return { message: "Here’s a more professional presentation. Your factual details and placeholders are kept.", suggestion };
  }
  if (/call to action|\bcta\b|order|contact|closing|ending/i.test(prompt)) {
    const closing = /contact|whatsapp|phone|\{bot_number\}|\{ref_link\}/i.test(caption)
      ? "Ready to order? Contact us using the details above."
      : "Interested? Get in touch to learn more.";
    return { message: "Here’s a clearer next step for your audience, with the original details kept.",
      suggestion: caption.endsWith(closing) ? caption : `${caption}\n\n${closing}` };
  }
  return { message: "This is a demo assistant. Try ‘Make it shorter’, ‘Use a professional tone’, or ‘Improve the call to action’. Other requests will need a connected AI service." };
}
