import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiscoveredGroups } from "@/app/groups/_components/discovered-groups";
import type { DiscoveredGroup, GroupDiscovery } from "@/src/lib/types";

const stamp = "2026-11-08T06:00:00.000Z";
const group: DiscoveredGroup = { jid: "120363407345824911@g.us", name: "The Advertisement Hub (Buy & Sell)",
  firstSeenAt: stamp, lastSeenAt: stamp,
  accounts: ["ads", "default"].map(accountId => ({ accountId, firstSeenAt: stamp, lastSeenAt: stamp })) };
const health = (status: GroupDiscovery["accounts"][number]["status"]): GroupDiscovery => ({ enabled: status !== "disabled",
  accounts: [{ accountId: "ads", status, lastAttemptAt: stamp, lastSuccessAt: status === "waiting" ? null : stamp,
    lastError: status === "error" ? "lookup_failed" : null }] });

describe("automatic group discovery", () => {
  it("includes DMC and member observations in unassigned rows", () => {
    const html = renderToStaticMarkup(createElement(DiscoveredGroups, { groups: [{ ...group,
      metrics: { dailyMessageCount: 0, coverage: "partial", memberCount: 120,
        windowStart: stamp, asOf: "2026-11-09T06:00:00Z", memberCountObservedAt: stamp } }] }));
    expect(html).toContain('aria-label="Daily Message Count"');
    expect(html).toContain("Members");
    expect(html).toContain("Partial");
    expect(html).toContain("Stale");
    expect(html).toContain(">120<");
    expect(html).toContain(">0<");
  });
  it("renders nothing for older backends without discovery fields", () => {
    expect(renderToStaticMarkup(createElement(DiscoveredGroups, {}))).toBe("");
  });

  it("shows the full ID, name and both accounts as an unassigned observation without write controls", () => {
    const html = renderToStaticMarkup(createElement(DiscoveredGroups, { groups: [group], discovery: health("ok") }));
    expect(html).toContain("Unassigned");
    expect(html).toContain(group.jid);
    expect(html).toContain("The Advertisement Hub (Buy &amp; Sell)");
    expect(html).toContain("ads, default");
    expect(html).toContain("2026-11-08 06:00:00 UTC");
    expect(html).toContain("No campaigns are assigned automatically");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Delete");
  });

  it("keeps saved groups visible when discovery is stale, failing or disabled", () => {
    for (const [status, text] of [["stale", "out of date"], ["error", "Discovery unavailable"], ["disabled", "discovery is paused"]] as const) {
      const html = renderToStaticMarkup(createElement(DiscoveredGroups, { groups: [group], discovery: health(status) }));
      expect(html).toContain(text);
      expect(html).toContain(group.jid);
      expect(html).toContain("not a guarantee");
    }
  });

  it("distinguishes waiting for discovery from an empty inventory and handles unnamed groups", () => {
    const waiting = renderToStaticMarkup(createElement(DiscoveredGroups, { groups: [], discovery: health("waiting") }));
    expect(waiting).toContain("Waiting for the first scan");
    expect(waiting).toContain("No saved unassigned groups");
    const unnamed = renderToStaticMarkup(createElement(DiscoveredGroups, { groups: [{ ...group, name: null }] }));
    expect(unnamed).toContain("Unnamed group");
    expect(unnamed).toContain(group.jid);
  });

  it("escapes WhatsApp subjects rather than interpreting group names as HTML", () => {
    const html = renderToStaticMarkup(createElement(DiscoveredGroups, { groups: [{ ...group, name: '<script>alert("x")</script>' }] }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
