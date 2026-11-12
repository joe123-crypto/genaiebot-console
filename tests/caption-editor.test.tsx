// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn(), push: vi.fn(), refresh: vi.fn(), reply: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/app/campaigns/actions", () => ({ saveCaptionsAction: mocks.save }));
vi.mock("@/app/campaigns/caption-ai-actions", () => ({ suggestCaptionAction: mocks.reply }));
import { CaptionEditor, CaptionEditorScreen } from "@/app/campaigns/_components/caption-editor";
import { captionDraftKey } from "@/src/lib/caption-editor";
import { healthy, failure, preview, success } from "./fixtures/campaign-detail";
const props = { slug: "borehole-drilling", name: "Borehole Drilling", variant: "1", writable: true,
  captions: ["Water $25\n\nCall {bot_number} {ref_link}", "Other caption"] };
function mount(overrides = {}) { return render(createElement(CaptionEditor, { ...props, ...overrides })); }
function text() { return screen.getByRole("textbox", { name: "Caption text" }) as HTMLTextAreaElement; }
function edit(value = "Edited 💧\n\n{bot_number} {ref_link}") { fireEvent.change(text(), { target: { value } }); }
async function save() { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save caption" })); }); }
async function chat() { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Make it shorter" })); }); }
beforeEach(() => {
  sessionStorage.clear(); vi.clearAllMocks();
  mocks.save.mockResolvedValue({ ok: true });
  mocks.reply.mockResolvedValue({ ok: true, reply: { message: "A shorter suggestion", suggestion: "Water $25\nCall {bot_number} {ref_link}" } });
});
afterEach(cleanup);

describe("caption editing", () => {
  it("loads the original template, live preview, and disabled pristine save", () => {
    mount();
    expect(text().value).toBe(props.captions[0]);
    expect(screen.getByRole("heading", { name: "Edit caption · Variant 1" })).toBeDefined();
    expect(within(screen.getByRole("region", { name: "Preview" })).getByText(props.captions[0].replace(/\s+/g, " "))).toBeDefined();
    expect((screen.getByRole("button", { name: "Save caption" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves only the selected variant while preserving siblings and expected baseline", async () => {
    mount(); edit();
    const stored = JSON.parse(sessionStorage.getItem(captionDraftKey(props.slug, "1"))!);
    expect(stored.text).toBe(text().value);
    await save();
    expect(mocks.save).toHaveBeenCalledWith(props.slug, ["Edited 💧\n\n{bot_number} {ref_link}", props.captions[1]], props.captions);
    expect(mocks.push).toHaveBeenCalledWith(`/campaigns/${props.slug}`);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(captionDraftKey(props.slug, "1"))).toBeNull();
  });

  it("creates a new variant only on save", async () => {
    mount({ variant: "new" });
    expect(text().value).toBe("");
    edit("New {ref_link}"); await save();
    expect(mocks.save).toHaveBeenCalledWith(props.slug, [...props.captions, "New {ref_link}"], props.captions);
  });

  it("blocks blank and oversized captions", () => {
    mount(); edit(" \n ");
    expect((screen.getByRole("button", { name: "Save caption" }) as HTMLButtonElement).disabled).toBe(true);
    edit("💧".repeat(16000));
    expect(screen.getByRole("alert").textContent).toContain("too large");
    expect((screen.getByRole("button", { name: "Save caption" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("retains failed saves for retry and locks inputs while saving", async () => {
    let resolve!: (value: { ok: false; detail: string }) => void;
    mocks.save.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    mount(); edit(); await save();
    expect(text().disabled).toBe(true);
    expect((screen.getByRole("textbox", { name: "Message the caption assistant" }) as HTMLTextAreaElement).disabled).toBe(true);
    await act(async () => resolve({ ok: false, detail: "Connection busy" }));
    expect(screen.getByRole("alert").textContent).toBe("Connection busy");
    expect(text().value).toContain("Edited");
    await save(); expect(mocks.push).toHaveBeenCalledOnce();
  });

  it("retains drafts after an uncertain transport failure", async () => {
    mocks.save.mockRejectedValueOnce(new Error("network"));
    mount(); edit(); await save();
    expect(screen.getByRole("alert").textContent).toContain("Could not confirm");
    expect(text().value).toContain("Edited");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(captionDraftKey(props.slug, "1"))).toContain("Edited");
  });

  it("retains typing during polling and requires reset after an external edit", () => {
    const view = mount(); edit();
    view.rerender(createElement(CaptionEditor, { ...props, captions: [...props.captions] }));
    expect(text().value).toContain("Edited");
    view.rerender(createElement(CaptionEditor, { ...props, captions: ["Latest", props.captions[1]] }));
    expect(text().value).toContain("Edited");
    expect(screen.getByRole("alert").textContent).toContain("Captions changed");
    expect((screen.getByRole("button", { name: "Save caption" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset to latest" }));
    expect(text().value).toBe("Latest");
    edit("Latest edited");
    expect((screen.getByRole("button", { name: "Save caption" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("uses the fresh caption snapshot returned by a save conflict when resetting", async () => {
    const latest = ["Latest from the bot", props.captions[1]];
    mocks.save.mockResolvedValueOnce({ ok: false, detail: "Captions changed since you started editing.", latestCaptions: latest });
    mount(); edit(); await save();
    expect(text().value).toContain("Edited");
    expect((screen.getByRole("button", { name: "Save caption" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset to latest" }));
    expect(text().value).toBe("Latest from the bot");
    edit("Latest edited"); await save();
    expect(mocks.save).toHaveBeenLastCalledWith(props.slug, ["Latest edited", props.captions[1]], latest);
  });

  it("restores drafts on remount, isolates variants, and keeps old baselines to detect conflicts", () => {
    const view = mount(); edit(); view.unmount();
    const other = mount({ variant: "2" }); expect(text().value).toBe(props.captions[1]); other.unmount();
    mount({ captions: ["Changed elsewhere", props.captions[1]] });
    expect(text().value).toContain("Edited");
    expect(screen.getByRole("alert").textContent).toContain("Captions changed");
  });

  it("recognizes a saved draft already reflected by the server", () => {
    sessionStorage.setItem(captionDraftKey(props.slug, "1"), JSON.stringify({ version: 1, base: props.captions, text: "Saved already" }));
    mount({ captions: ["Saved already", props.captions[1]] });
    expect(text().value).toBe("Saved already");
    expect(sessionStorage.getItem(captionDraftKey(props.slug, "1"))).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("cancel explicitly discards a draft after confirmation; back retains it", () => {
    mount(); edit();
    expect(screen.getByRole("link", { name: "Back to campaign" }).getAttribute("href")).toBe(`/campaigns/${props.slug}`);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(text().value).toContain("Edited");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Discard draft" }));
    expect(sessionStorage.getItem(captionDraftKey(props.slug, "1"))).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledOnce();
  });

  it("keeps manual drafting available without a save connection", () => {
    mount({ saveUnavailableReason: "Saving is unavailable" }); edit();
    expect(screen.getByText("Saving is unavailable")).toBeDefined();
    expect((screen.getByRole("button", { name: "Save caption" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables manual editing, AI and save in read-only mode", () => {
    mount({ writable: false });
    expect(text().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Make it shorter" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("handles nonexistent variants without a blank editor", () => {
    mount({ variant: "99" });
    expect(screen.getByRole("heading", { name: "Caption variant unavailable" })).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "Caption text" })).toBeNull();
  });

  it("ignores corrupted browser data and explains unavailable storage", () => {
    sessionStorage.setItem(captionDraftKey(props.slug, "1"), JSON.stringify({ version: 1, base: "bad", text: false }));
    mount();
    expect(text().value).toBe(props.captions[0]);
    expect(screen.getByText(/saved draft could not be restored/)).toBeDefined();
  });

  it("keeps editing and saving usable when session storage is blocked", async () => {
    const store = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    try {
      mount(); edit();
      expect(text().value).toContain("Edited");
      expect(screen.getByText(/Browser storage is unavailable/)).toBeDefined();
      await save();
      expect(mocks.save).toHaveBeenCalledOnce();
    } finally { store.mockRestore(); }
  });
});

describe("OpenRouter AI chat", () => {
  it("keeps manual editing and saving available when OpenRouter is not configured", () => {
    mount({ aiUnavailableReason: "Configure OPENROUTER_API_KEY on the server." }); edit();
    expect(text().disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Save caption" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Make it shorter" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Configure OPENROUTER_API_KEY on the server.")).toBeDefined();
  });

  it("shows provider errors with an explicit retry and leaves the caption unchanged", async () => {
    mocks.reply.mockResolvedValueOnce({ ok: false, detail: "OpenRouter is busy." });
    mount(); await chat();
    expect(screen.getByRole("alert").textContent).toBe("OpenRouter is busy.");
    expect(text().value).toBe(props.captions[0]);
    expect(screen.queryByRole("button", { name: "Apply suggestion" })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry request" })); });
    expect(screen.getByRole("button", { name: "Apply suggestion" })).toBeDefined();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("keeps the original CTA request and rejection in context when the user follows up about placeholders", async () => {
    const original = "I want there added a call to action with a link to the whatsapp bot number:+263785632943";
    mocks.reply.mockResolvedValueOnce({ ok: false, detail: "The suggestion did not preserve template placeholders." });
    mount();
    const composer = screen.getByRole("textbox", { name: "Message the caption assistant" });
    fireEvent.change(composer, { target: { value: original } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send message" })); });
    fireEvent.change(composer, { target: { value: "keep all placeholders" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send message" })); });
    const followup = mocks.reply.mock.calls[1][0];
    expect(followup.prompt).toBe("keep all placeholders");
    expect(followup.history[0]).toEqual({ role: "user", content: original });
    expect(JSON.parse(followup.history[1].content)).toEqual({ message: "The suggestion did not preserve template placeholders.", suggestion: null, state: "rejected" });
    expect(text().value).toBe(props.captions[0]);
  });

  it("sends recent conversation, application state and the current draft for follow-up requests", async () => {
    mount(); await chat();
    fireEvent.click(screen.getByRole("button", { name: "Apply suggestion" }));
    edit("Manual follow-up {bot_number} {ref_link}");
    fireEvent.change(screen.getByRole("textbox", { name: "Message the caption assistant" }), { target: { value: "Make that friendlier" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send message" })); });
    const request = mocks.reply.mock.calls[1][0];
    expect(request.caption).toBe("Manual follow-up {bot_number} {ref_link}");
    expect(request.prompt).toBe("Make that friendlier");
    expect(request.history[0]).toEqual({ role: "user", content: "Make it shorter" });
    expect(JSON.parse(request.history[1].content)).toMatchObject({ state: "applied", suggestion: "Water $25\nCall {bot_number} {ref_link}" });
  });

  it("labels the model and applies only on request, with undo and no automatic save", async () => {
    mount(); await chat();
    expect(screen.getByText("DeepSeek V4.1 Flash")).toBeDefined();
    expect(mocks.reply).toHaveBeenCalledWith({ prompt: "Make it shorter", caption: props.captions[0], history: [] });
    expect(text().value).toBe(props.captions[0]);
    fireEvent.click(screen.getByRole("button", { name: "Apply suggestion" }));
    expect(text().value).toBe("Water $25\nCall {bot_number} {ref_link}");
    expect(screen.getByText("Applied to draft")).toBeDefined();
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Undo AI edit" }));
    expect(text().value).toBe(props.captions[0]);
  });

  it("dismisses a suggestion without touching the caption", async () => {
    mount(); await chat();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("button", { name: "Apply suggestion" })).toBeNull();
    expect(screen.getByText("Suggestion dismissed.")).toBeDefined();
    expect(text().value).toBe(props.captions[0]);
  });

  it("invalidates suggestions after manual edits, including returning to the old text", async () => {
    mount(); await chat(); edit("New draft"); edit(props.captions[0]);
    expect(screen.queryByRole("button", { name: "Apply suggestion" })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Regenerate" })); });
    expect(mocks.reply).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Apply suggestion" })).toBeDefined();
  });

  it("marks suggestions stale when typing continued while the reply was pending", async () => {
    let resolve!: (value: { ok: true; reply: { message: string; suggestion: string } }) => void;
    mocks.reply.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    mount(); await chat();
    expect(screen.getByText("Thinking about your caption…")).toBeDefined();
    edit("While waiting");
    text().focus();
    await act(async () => resolve({ ok: true, reply: { message: "Done", suggestion: "Older text" } }));
    expect(document.activeElement).toBe(text());
    expect(screen.queryByRole("button", { name: "Apply suggestion" })).toBeNull();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeDefined();
  });

  it("supports typed prompts and Enter, preserves multiline composition, and prevents duplicate requests", async () => {
    let resolve!: (value: { ok: true; reply: { message: string } }) => void;
    mocks.reply.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    mount();
    const input = screen.getByRole("textbox", { name: "Message the caption assistant" });
    fireEvent.change(input, { target: { value: "Professional\nplease" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(mocks.reply).not.toHaveBeenCalled();
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(mocks.reply).toHaveBeenCalledWith({ prompt: "Professional\nplease", caption: props.captions[0], history: [] });
    fireEvent.change(input, { target: { value: "Another request" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.reply).toHaveBeenCalledOnce();
    await act(async () => resolve({ ok: true, reply: { message: "Done" } }));
    expect(document.activeElement).toBe(input);
  });

  it("clears AI undo after manual editing so newer text cannot be overwritten", async () => {
    mount(); await chat();
    fireEvent.click(screen.getByRole("button", { name: "Apply suggestion" })); edit("Manual follow-up");
    expect(screen.queryByRole("button", { name: "Undo AI edit" })).toBeNull();
  });
});

describe("editor resource resilience", () => {
  const screenProps = { slug: props.slug, variant: "1", writable: true, detail: healthy };
  it.each(["campaign", "preview", "writes"] as const)("keeps edits and blocks saving during a failed %s refresh", (key) => {
    const view = render(createElement(CaptionEditorScreen, screenProps)); edit();
    view.rerender(createElement(CaptionEditorScreen, { ...screenProps, detail: { ...healthy, [key]: failure } }));
    expect(text().value).toContain("Edited");
    expect((screen.getByRole("button", { name: "Save caption" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry" })); expect(mocks.refresh).toHaveBeenCalled();
    view.rerender(createElement(CaptionEditorScreen, screenProps));
    expect((screen.getByRole("button", { name: "Save caption" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("does not open an empty editor when initial preview loading fails", () => {
    render(createElement(CaptionEditorScreen, { ...screenProps, detail: { ...healthy, preview: failure } }));
    expect(screen.queryByRole("textbox", { name: "Caption text" })).toBeNull();
    expect(screen.getByText(/Caption data is unavailable/)).toBeDefined();
  });
  it("keeps the draft when the selected variant disappears during a refresh", () => {
    const view = render(createElement(CaptionEditorScreen, screenProps)); edit();
    view.rerender(createElement(CaptionEditorScreen, { ...screenProps, detail: { ...healthy, preview: success({ ...preview, captions: [] }) } }));
    expect(text().value).toContain("Edited");
    expect(screen.getByRole("alert").textContent).toContain("Captions changed");
  });
});

describe("campaign pictures in the assistant", () => {
  const images = ["https://pub-abc.r2.dev/ads/borehole-drilling/a.jpg", "https://pub-abc.r2.dev/ads/borehole-drilling/b.jpg"];
  function picture() { return screen.getByRole("checkbox", { name: /campaign pictures|campaign’s picture/ }) as HTMLInputElement; }

  it("offers the pictures, ticked, and sends them with the request", async () => {
    mount({ images });
    expect(picture().checked).toBe(true);
    await chat();
    expect(mocks.reply.mock.calls[0][0].images).toEqual(images);
  });
  it("sends nothing once the operator unticks the option", async () => {
    mount({ images });
    fireEvent.click(picture());
    expect(picture().checked).toBe(false);
    await chat();
    expect(mocks.reply.mock.calls[0][0].images).toBeUndefined();
  });
  it("names a single picture in the singular", () => {
    mount({ images: [images[0]] });
    expect(screen.getByText("Show the assistant this campaign’s picture")).toBeTruthy();
  });
  it("hides the option for a campaign with no pictures", async () => {
    mount();
    expect(screen.queryByRole("checkbox", { name: /picture/ })).toBeNull();
    await chat();
    expect(mocks.reply.mock.calls[0][0].images).toBeUndefined();
  });
});

describe("an unsaved draft kept from an earlier visit", () => {
  const stale = "ZEBRA MARKER LINE ONE";
  function keepDraft(text = stale) {
    sessionStorage.setItem(captionDraftKey(props.slug, props.variant),
      JSON.stringify({ version: 1, base: props.captions, text }));
  }

  it("says the caption on screen is a draft, not what is saved", () => {
    keepDraft();
    mount();
    expect(text().value).toBe(stale);
    expect(screen.getByText(/unsaved draft kept from an earlier visit/)).toBeTruthy();
  });
  it("loads the saved caption in one click and stops saying so", () => {
    keepDraft();
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Load the saved caption" }));
    expect(text().value).toBe(props.captions[0]);
    expect(screen.queryByText(/unsaved draft kept from an earlier visit/)).toBeNull();
  });
  it("stays quiet when the editor opens on the saved caption", () => {
    mount();
    expect(screen.queryByText(/unsaved draft kept from an earlier visit/)).toBeNull();
    edit();
    expect(screen.queryByText(/unsaved draft kept from an earlier visit/)).toBeNull();
  });
});

describe("a suggestion that drops part of the caption", () => {
  it("says how much shorter it is, so a silent truncation is visible", async () => {
    mocks.reply.mockResolvedValue({ ok: true, reply: { message: "Everything else is unchanged.", suggestion: "Water $25" } });
    mount();
    await chat();
    expect(screen.getByText(/shorter than your caption/)).toBeTruthy();
    expect(screen.getByText(/Check that nothing you need was dropped/)).toBeTruthy();
  });
  it("stays quiet for a suggestion that keeps the caption's substance", async () => {
    mocks.reply.mockResolvedValue({ ok: true, reply: { message: "Reworded.", suggestion: `${props.captions[0]} now` } });
    mount();
    await chat();
    expect(screen.queryByText(/shorter than your caption/)).toBeNull();
  });
});
