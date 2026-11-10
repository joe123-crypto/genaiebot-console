import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoCaptionReply } from "@/src/lib/caption-ai-demo";
import { isCaptionVariant } from "@/src/lib/caption-editor";
const original = "Hey folks!\n\n🧱 Bricks: $95 per 1000\n\n📞 Contact +263 775 489 417\n{bot_number} {ref_link}";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
async function reply(prompt: string, caption = original) {
  const pending = demoCaptionReply(prompt, caption);
  await vi.runAllTimersAsync();
  return pending;
}
describe("frontend caption demo", () => {
  it.each(["Make it shorter", "Use a professional tone", "Improve the call to action", "Can you make this concise?", "Polish this for business"])("preserves facts and placeholders for %s", async (prompt) => {
    const result = await reply(prompt);
    for (const value of ["Bricks: $95 per 1000", "+263 775 489 417", "{bot_number}", "{ref_link}"]) {
      expect(result.suggestion).toContain(value);
    }
    expect(result.suggestion).not.toBe(original);
  });
  it.each(["Change the price to $30", "Translate to French", "Write a poem", "Make it shorter and replace the phone number"])("explains unsupported requests without offering fake changes: %s", async (prompt) => {
    const result = await reply(prompt);
    expect(result.suggestion).toBeUndefined();
    expect(result.message).toMatch(/demo/i);
  });
  it("asks for a starting caption for empty drafts", async () => {
    expect((await reply("Make it shorter", "  ")).suggestion).toBeUndefined();
    expect((await reply("Make it shorter", "  ")).message).toContain("Write a caption first");
  });
  it.each(["0", "-1", "01", "1.5", "abc", "9007199254740992"])("rejects malformed variant URLs: %s", (variant) => {
    expect(isCaptionVariant(variant)).toBe(false);
  });
});
