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


it("keeps distinct links that share the selected URL as a prefix", () => {
  const selected = "https://wa.me/26370000001";
  const other = `${selected}0`;
  const query = `${selected}?text=hello`;
  const caption = `Chat (${selected}). Other: ${other} Query: ${query} Again: *${selected}*`;
  expect(proposeTrackedLink(caption, "+26370000003", "sale", "Sale", {}, selected).caption)
    .toBe(`Chat ({ref_link}). Other: ${other} Query: ${query} Again: *{ref_link}*`);
});

describe("direct ref links", () => {
  it("appends a no-data line with the direct placeholder", () => {
    const result = proposeTrackedLink("Offer", "+26370000003", "sale", "Sale", {}, undefined, "direct");
    expect(result.caption).toBe("Offer\n\n📲 No data? Chat on WhatsApp: {direct_ref_link}");
    expect(result.tracking).toEqual({ prefix: "sale", label: "Sale", number: "+26370000003" });
  });
  it("replaces a chosen pasted link and keeps a tracked link beside it", () => {
    const caption = "Tap {ref_link}\nOrder: https://wa.me/263783496308.";
    const [pasted] = whatsappLinks(caption);
    expect(proposeTrackedLink(caption, "+263783496308", "sale", "Sale", {}, pasted, "direct").caption)
      .toBe("Tap {ref_link}\nOrder: {direct_ref_link}.");
  });
  it("does not duplicate an existing direct placeholder", () => {
    expect(proposeTrackedLink("Chat {direct_ref_link}", "+26370000003", "sale", "Sale", {}, undefined, "direct").caption).toBe("Chat {direct_ref_link}");
  });
});
