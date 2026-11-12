// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), push: vi.fn(), refresh: vi.fn(), reply: vi.fn(), files: vi.fn(), forget: vi.fn(), shrink: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/app/campaigns/new/actions", () => ({ createCampaignAction: mocks.create }));
vi.mock("@/app/campaigns/caption-ai-actions", () => ({ suggestCaptionAction: mocks.reply }));
vi.mock("@/src/lib/campaign-files", () => ({ draftFiles: mocks.files, forgetDraftFiles: mocks.forget, keepDraftFiles: vi.fn() }));
vi.mock("@/src/lib/caption-pictures", () => ({ picturesForAI: mocks.shrink }));
import { CampaignCaptionStep } from "@/app/campaigns/_components/campaign-caption-step";
import { CAMPAIGN_CAPTIONS_KEY, CAMPAIGN_DRAFT_KEY } from "@/src/lib/campaign-draft";

const sha = "a".repeat(64);
const draft = {
  requestId: "12345678-1234-1234-1234-123456789abc", slug: "sale", name: "Sale", enabled: false,
  images: [{ filename: "sale.png", key: `ads/sale/${sha}.png`, sha256: sha, bytes: 3, contentType: "image/png" }],
  schedule: { time: "10:00", timezone: "Africa/Harare", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  groups: [{ jid: "1@g.us" }],
};
const props = { gate: { allowed: true as const } };
function stash(value: unknown = { version: 1, draft }) { sessionStorage.setItem(CAMPAIGN_DRAFT_KEY, JSON.stringify(value)); }
function text() { return screen.getByRole("textbox", { name: "Caption text" }) as HTMLTextAreaElement; }
function createButton() { return screen.getByRole("button", { name: /Create campaign|Retry original request/ }) as HTMLButtonElement; }
function write(value: string) { fireEvent.change(text(), { target: { value } }); }
async function keep() { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save caption" })); }); }
async function create() { await act(async () => { fireEvent.click(createButton()); }); }

beforeEach(() => {
  sessionStorage.clear(); vi.clearAllMocks();
  mocks.create.mockResolvedValue({ ok: true, slug: "sale", scheduling: "ready" });
  mocks.reply.mockResolvedValue({ ok: true, reply: { message: "Shorter", suggestion: "Shorter caption" } });
  mocks.shrink.mockResolvedValue([]);
  mocks.files.mockResolvedValue(new Map([[`ads/sale/${sha}.png`, new File([new Uint8Array([1, 2, 3])], "sale.png", { type: "image/png" })]]));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://r2.example/put", headers: {} }) }).mockResolvedValue({ ok: true }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("campaign caption step", () => {
  it("opens in the editor and only allows creating once a caption is written", async () => {
    stash();
    render(<CampaignCaptionStep {...props} />);
    expect(screen.getByRole("heading", { name: "Captions" })).toBeTruthy();
    expect(createButton().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save caption" }) as HTMLButtonElement).disabled).toBe(true);
    write("   ");
    expect((screen.getByRole("button", { name: "Save caption" }) as HTMLButtonElement).disabled).toBe(true);
    write("Our latest sale");
    await keep();
    expect(createButton().disabled).toBe(false);
    expect(screen.getByText("Variant 1")).toBeTruthy();
    await create();
    // The pictures go up here, with the campaign, and not a moment earlier.
    expect(fetch).toHaveBeenCalledTimes(2); // One signing request and one PUT.
    expect(mocks.create).toHaveBeenCalledWith({ ...draft, captions: ["Our latest sale"] });
    expect(mocks.forget).toHaveBeenCalled();
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/campaigns/sale"));
    expect(sessionStorage.getItem(CAMPAIGN_DRAFT_KEY)).toBeNull();
    expect(sessionStorage.getItem(CAMPAIGN_CAPTIONS_KEY)).toBeNull();
  });
  it("adds, edits and deletes further variants, and creates them in order", async () => {
    stash();
    render(<CampaignCaptionStep {...props} />);
    write("First"); await keep();
    fireEvent.click(screen.getByRole("button", { name: "Add variant" }));
    write("Second"); await keep();
    fireEvent.click(screen.getByRole("button", { name: "Add variant" }));
    write("Third"); await keep();
    fireEvent.click(screen.getByRole("button", { name: "Edit variant 2" }));
    expect(text().value).toBe("Second");
    write("Second, reworded"); await keep();
    fireEvent.click(screen.getByRole("button", { name: "Delete variant 1" }));
    await create();
    expect(mocks.create.mock.calls[0][0].captions).toEqual(["Second, reworded", "Third"]);
  });
  it("cannot create while a caption is open in the editor", async () => {
    stash();
    render(<CampaignCaptionStep {...props} />);
    write("First"); await keep();
    fireEvent.click(screen.getByRole("button", { name: "Add variant" }));
    expect(createButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel caption" }));
    expect(createButton().disabled).toBe(false);
  });
  it("keeps the captions across a reload and refuses to create without the details", async () => {
    stash();
    const view = render(<CampaignCaptionStep {...props} />);
    write("Kept caption"); await keep();
    expect(JSON.parse(sessionStorage.getItem(CAMPAIGN_CAPTIONS_KEY)!).captions).toEqual(["Kept caption"]);
    view.unmount();
    render(<CampaignCaptionStep {...props} />);
    expect(screen.getByText("Kept caption")).toBeTruthy();
    expect(createButton().disabled).toBe(false);
    cleanup();
    sessionStorage.removeItem(CAMPAIGN_DRAFT_KEY);
    render(<CampaignCaptionStep {...props} />);
    expect(screen.getByRole("heading", { name: "Campaign details are no longer held" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to campaign details" }).getAttribute("href")).toBe("/campaigns/new");
  });
  it("locks edits and retries the same request after an unknown outcome", async () => {
    stash();
    mocks.create.mockResolvedValueOnce({ ok: false, detail: "Outcome unknown; retry this request", outcome: "unknown" });
    render(<CampaignCaptionStep {...props} />);
    write("Our latest sale"); await keep();
    await create();
    await screen.findByText("Outcome unknown; retry this request");
    expect(screen.getByRole("link", { name: "Check campaign" }).getAttribute("href")).toBe("/campaigns/sale");
    expect((screen.getByRole("button", { name: "Add variant" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Our latest sale")).toBeTruthy();
    await create();
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1][0]).toEqual(mocks.create.mock.calls[0][0]);
  });
  it("allows correction after a definite refusal", async () => {
    stash();
    mocks.create.mockResolvedValueOnce({ ok: false, detail: "Invalid caption", outcome: "not-created" });
    render(<CampaignCaptionStep {...props} />);
    write("Bad caption"); await keep();
    await create();
    await screen.findByText("Invalid caption");
    expect(screen.queryByRole("link", { name: "Check campaign" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit variant 1" }));
    write("Corrected caption"); await keep();
    await create();
    expect(mocks.create.mock.calls[1][0].captions).toEqual(["Corrected caption"]);
  });
  it("reports a pending schedule instead of navigating", async () => {
    stash();
    mocks.create.mockResolvedValue({ ok: true, slug: "sale", scheduling: "pending", warning: "Scheduling will retry" });
    render(<CampaignCaptionStep {...props} />);
    write("Our latest sale"); await keep();
    await create();
    await screen.findByText(/Scheduling will retry/);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Open saved campaign" }).getAttribute("href")).toBe("/campaigns/sale");
    expect(createButton().disabled).toBe(true);
  });
  it("lets a read-only operator write captions but not create", async () => {
    stash();
    render(<CampaignCaptionStep gate={{ allowed: false, reason: "The console is in read-only mode." }} />);
    write("Prepared caption"); await keep();
    expect(screen.getByText(/The console is in read-only mode./)).toBeTruthy();
    expect(createButton().disabled).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("starts fresh when the stashed details cannot be trusted", () => {
    stash({ version: 1, draft: { name: "Half a campaign" } });
    render(<CampaignCaptionStep {...props} />);
    expect(screen.getByRole("heading", { name: "Campaign details are no longer held" })).toBeTruthy();
  });
});

describe("campaign caption step uploads", () => {
  it("keeps the captions and creates nothing when a picture cannot upload", async () => {
    stash();
    vi.mocked(fetch).mockReset().mockResolvedValue({ ok: false, json: async () => ({ error: "Upload unavailable" }) } as Response);
    render(<CampaignCaptionStep {...props} />);
    write("Our latest sale"); await keep();
    await create();
    await screen.findByText("Upload unavailable");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Check campaign" })).toBeNull();
    expect(screen.getByText("Our latest sale")).toBeTruthy();
    expect(createButton().disabled).toBe(false);
  });
  it("uploads each picture once across a retry", async () => {
    stash();
    mocks.create.mockResolvedValueOnce({ ok: false, detail: "Invalid caption", outcome: "not-created" });
    render(<CampaignCaptionStep {...props} />);
    write("Our latest sale"); await keep();
    await create();
    await screen.findByText("Invalid caption");
    await create();
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("sends the operator back for pictures that are no longer held", async () => {
    stash();
    mocks.files.mockResolvedValue(new Map());
    render(<CampaignCaptionStep {...props} />);
    write("Our latest sale"); await keep();
    await create();
    await screen.findByText(/The chosen pictures are no longer held/);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("campaign pictures in the create-flow assistant", () => {
  it("offers the not-yet-uploaded pictures to the assistant as downscaled copies", async () => {
    const shrunk = ["data:image/jpeg;base64,AAAA"];
    mocks.shrink.mockResolvedValue(shrunk);
    stash();
    render(<CampaignCaptionStep {...props} />);
    const option = await screen.findByRole("checkbox", { name: /campaign\u2019s picture/ });
    expect((option as HTMLInputElement).checked).toBe(true);
    // Only the files this draft actually holds are shrunk, in posting order.
    expect(mocks.shrink.mock.calls[0][0].map((file: File) => file.name)).toEqual(["sale.png"]);
    write("Write me something"); 
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Make it shorter" })); });
    expect(mocks.reply.mock.calls[0][0].images).toEqual(shrunk);
  });
  it("keeps the assistant usable when the pictures cannot be read", async () => {
    mocks.shrink.mockRejectedValue(new Error("decode failed"));
    stash();
    render(<CampaignCaptionStep {...props} />);
    write("Our latest sale"); await keep();
    expect(screen.queryByRole("checkbox", { name: /picture/ })).toBeNull();
    expect(createButton().disabled).toBe(false);
  });
});
