// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ publish: vi.fn(), check: vi.fn(), replies: vi.fn() }));
vi.mock("@/app/customer-bot/actions", () => ({
  checkCustomerBotAction: mocks.check, publishCustomerBotAction: mocks.publish, setCustomerBotRepliesAction: mocks.replies,
}));
import { CustomerBotEditor } from "@/app/customer-bot/_components/customer-bot-editor";
import type { CustomerBotVersion } from "@/src/lib/customer-bot-types";

const initial = { instructions: "Reply directly.", sources: [{ id: "campaigns", label: "Live campaigns", description: "Current advertised offers." }],
  revision: "a".repeat(32), publishedAt: "2026-11-15T00:00:00Z", publishedBy: "Operator" };
const changed = { ...initial, instructions: "Start with the price.", revision: "b".repeat(32) };
const draftKey = "customer-bot-test";
function open(writable = true, live: CustomerBotVersion = initial) {
  return render(<CustomerBotEditor initial={live} writable={writable} draftKey={draftKey} />);
}
function field(name = "Reply instructions") {
  return screen.getByRole("textbox", { name }) as HTMLTextAreaElement;
}
function button(name: string) {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}
function edit() {
  fireEvent.change(field(), { target: { value: changed.instructions } });
}
async function click(name: string) {
  await act(async () => { fireEvent.click(button(name)); });
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
});
afterEach(cleanup);

describe("customer bot editor", () => {
  it("restores the tab draft, reviews only changed sections, and publishes explicitly", async () => {
    const screenVisit = open();
    expect(field().value).toBe(initial.instructions);
    expect(screen.queryByRole("textbox", { name: "Business knowledge" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Connected data sources" })).toBeDefined();
    expect(screen.getByText("Live campaigns")).toBeDefined();
    edit();
    screenVisit.unmount();
    open();
    expect(field().value).toBe(changed.instructions);
    await click("Review changes");
    expect(screen.getByRole("heading", { name: "Reply instructions" })).toBeDefined();
    expect(screen.getByText("Reply directly.")).toBeDefined();
    expect(screen.getByText("Start with the price.")).toBeDefined();
    expect(mocks.publish).not.toHaveBeenCalled();
    mocks.publish.mockResolvedValue({ kind: "published", live: changed });
    await click("Publish to WhatsApp bot");
    expect(mocks.publish).toHaveBeenCalledWith({ instructions: changed.instructions }, initial.revision);
    expect(field().value).toBe(changed.instructions);
    expect(sessionStorage.getItem(draftKey)).toBeNull();
  });

  it("preserves edited instructions on a conflict and requires a fresh review", async () => {
    open(); edit();
    await click("Review changes");
    const other = { ...initial, instructions: "Use a friendly greeting.", revision: "c".repeat(32) };
    mocks.publish.mockResolvedValue({ kind: "conflict", live: other });
    await click("Publish to WhatsApp bot");
    expect(screen.getByText(other.instructions)).toBeDefined();
    expect(field().value).toBe(changed.instructions);
    expect(screen.queryByRole("button", { name: "Publish to WhatsApp bot" })).toBeNull();
    await click("Use latest as base");
    expect(field("Reply instructions").value).toBe(changed.instructions);
    expect(field().value).toBe(changed.instructions);
    await click("Review changes");
  });

  it("requires a live check after an unconfirmed publish and clears an already applied draft", async () => {
    open(); edit();
    await click("Review changes");
    mocks.publish.mockRejectedValue(new Error("Connection lost"));
    await click("Publish to WhatsApp bot");
    expect(screen.queryByRole("button", { name: "Publish to WhatsApp bot" })).toBeNull();
    expect(sessionStorage.getItem(draftKey)).toContain("Start with the price");
    mocks.check.mockResolvedValue({ kind: "live", live: changed });
    await click("Check live version");
    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(field().value).toBe(changed.instructions);
    expect(sessionStorage.getItem(draftKey)).toBeNull();
  });

  it("makes the live content readable without permitting changes in read-only mode", () => {
    open(false);
    expect(field().readOnly).toBe(true);
    expect(button("Review changes").disabled).toBe(true);
  });

  describe("who the bot replies to", () => {
    const everyone = { mode: "everyone", updatedAt: null, updatedBy: null } as const;
    const off = { mode: "off", updatedAt: "2026-11-27T10:00:00Z", updatedBy: "Operator" } as const;
    function radio(name: string) {
      return screen.getByRole("radio", { name: new RegExp(`^${name}`) }) as HTMLInputElement;
    }
    async function choose(name: string) {
      await act(async () => { fireEvent.click(radio(name)); });
    }

    it("saves a choice at once and shows it in the page heading", async () => {
      open(true, { ...initial, replies: everyone });
      expect(radio("Everyone").checked).toBe(true);
      expect(screen.queryByText("Replies off")).toBeNull();
      mocks.replies.mockResolvedValue({ kind: "saved", replies: off });
      await choose("Off");
      expect(mocks.replies).toHaveBeenCalledWith("off");
      expect(radio("Off").checked).toBe(true);
      expect(screen.getByText("Replies off")).toBeDefined();
      expect(screen.getByRole("group", { name: "Who the bot replies to" }).closest("section")?.textContent)
        .toMatch(/Changed .*2026.* by Operator/);
      expect(mocks.publish).not.toHaveBeenCalled();
    });

    it("goes back to the saved choice when the bot refuses", async () => {
      open(true, { ...initial, replies: everyone });
      mocks.replies.mockResolvedValue({ kind: "error", detail: "The bot rejected this reply setting." });
      await choose("Customers from your ads");
      expect(radio("Everyone").checked).toBe(true);
      expect(screen.getByRole("alert").textContent).toContain("rejected");
      expect(screen.queryByText("Ads only")).toBeNull();
    });

    it("is off for an older bot and in read-only mode", () => {
      const visit = open(true, initial);
      expect(radio("Everyone").matches(":disabled")).toBe(true);
      expect(screen.getByText("Update the bot to choose who it replies to.")).toBeDefined();
      visit.unmount();
      open(false, { ...initial, replies: off });
      expect(radio("Off").checked).toBe(true);
      expect(radio("Everyone").matches(":disabled")).toBe(true);
    });

    it("says when the bot could not read its setting and still lets it be saved", () => {
      open(true, { ...initial, replies: null });
      expect(screen.getByText(/couldn’t read this setting/)).toBeDefined();
      expect(radio("Everyone").checked).toBe(false);
      expect(radio("Everyone").matches(":disabled")).toBe(false);
    });
  });
});
