// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ publish: vi.fn(), check: vi.fn() }));
vi.mock("@/app/customer-bot/actions", () => ({
  checkCustomerBotAction: mocks.check, publishCustomerBotAction: mocks.publish,
}));
import { CustomerBotEditor } from "@/app/customer-bot/_components/customer-bot-editor";

const initial = { instructions: "Reply directly.", knowledge: "# Bricks\n\n$95 per 1000",
  revision: "a".repeat(32), publishedAt: "2026-11-15T00:00:00Z", publishedBy: "Operator" };
const changed = { ...initial, knowledge: "# Bricks\n\n$107 per 1000", revision: "b".repeat(32) };
const draftKey = "customer-bot-test";
function open(writable = true, live = initial) {
  return render(<CustomerBotEditor initial={live} writable={writable} draftKey={draftKey} />);
}
function field(name = "Business knowledge") {
  return screen.getByRole("textbox", { name }) as HTMLTextAreaElement;
}
function button(name: string) {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}
function edit() {
  fireEvent.change(field(), { target: { value: changed.knowledge } });
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
    expect(field().value).toBe(initial.knowledge);
    expect(field("Reply instructions").value).toBe(initial.instructions);
    edit();
    screenVisit.unmount();
    open();
    expect(field().value).toBe(changed.knowledge);
    await click("Review changes");
    expect(screen.getByRole("heading", { name: "Business knowledge" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Reply instructions" })).toBeNull();
    expect(screen.getByText("$95 per 1000")).toBeDefined();
    expect(screen.getByText("$107 per 1000")).toBeDefined();
    expect(mocks.publish).not.toHaveBeenCalled();
    mocks.publish.mockResolvedValue({ kind: "published", live: changed });
    await click("Publish to WhatsApp bot");
    expect(mocks.publish).toHaveBeenCalledWith({ instructions: initial.instructions, knowledge: changed.knowledge }, initial.revision);
    expect(field().value).toBe(changed.knowledge);
    expect(sessionStorage.getItem(draftKey)).toBeNull();
  });

  it("preserves the draft on a conflict and carries an untouched field forward", async () => {
    open(); edit();
    await click("Review changes");
    const other = { ...initial, instructions: "Start with the price.", revision: "c".repeat(32) };
    mocks.publish.mockResolvedValue({ kind: "conflict", live: other });
    await click("Publish to WhatsApp bot");
    expect(screen.getByText(other.instructions)).toBeDefined();
    expect(field().value).toBe(changed.knowledge);
    expect(screen.queryByRole("button", { name: "Publish to WhatsApp bot" })).toBeNull();
    await click("Use latest as base");
    expect(field("Reply instructions").value).toBe(other.instructions);
    expect(field().value).toBe(changed.knowledge);
    await click("Review changes");
    expect(screen.queryByRole("heading", { name: "Reply instructions" })).toBeNull();
  });

  it("requires a live check after an unconfirmed publish and clears an already applied draft", async () => {
    open(); edit();
    await click("Review changes");
    mocks.publish.mockRejectedValue(new Error("Connection lost"));
    await click("Publish to WhatsApp bot");
    expect(screen.queryByRole("button", { name: "Publish to WhatsApp bot" })).toBeNull();
    expect(sessionStorage.getItem(draftKey)).toContain("$107");
    mocks.check.mockResolvedValue({ kind: "live", live: changed });
    await click("Check live version");
    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(field().value).toBe(changed.knowledge);
    expect(sessionStorage.getItem(draftKey)).toBeNull();
  });

  it("makes the live content readable without permitting changes in read-only mode", () => {
    open(false);
    expect(field().readOnly).toBe(true);
    expect(button("Review changes").disabled).toBe(true);
  });
});
