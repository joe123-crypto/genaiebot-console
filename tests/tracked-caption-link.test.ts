import { describe, expect, it } from "vitest";
import { internationalNumber, proposeTrackedLink, whatsappLinks } from "@/src/lib/tracked-caption-link";

describe("tracked caption links", () => {
  it.each(["+263 700 000 01", "0026370000001", "26370000001"])("normalizes international destination %s", (input) => {
    expect(internationalNumber(input)).toBe("+26370000001");
  });
  it.each(["123", "+026370000001", "+26370000001 ext 3", "https://wa.me/26370000001"])("rejects ambiguous or invalid numbers %s", (input) => {
    expect(internationalNumber(input)).toBeUndefined();
  });
  it("replaces only the chosen link, preserving formatting and unrelated contacts", () => {
    const caption = "*Offer* {bot_number}\nChat (https://wa.me/26370000001).\nOther: https://wa.me/26370000002";
    const [selected] = whatsappLinks(caption);
    const result = proposeTrackedLink(caption, "+26370000003", "sale", "Sale", { prefix: "KEEP", prefill: "Hello {ref}" }, selected);
    expect(result.caption).toBe("*Offer* {bot_number}\nChat ({ref_link}).\nOther: https://wa.me/26370000002");
    expect(result.tracking).toEqual({ prefix: "KEEP", prefill: "Hello {ref}", label: "Sale", number: "+26370000003" });
  });
  it("changes the destination without duplicating an existing tracked placeholder", () => {
    const caption = "Chat {ref_link}";
    expect(proposeTrackedLink(caption, "+26370000003", "sale", "Sale").caption).toBe(caption);
  });
});
