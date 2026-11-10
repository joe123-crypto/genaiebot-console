import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), notFound: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/src/domains/campaign-detail", () => ({ loadCaptionEditorDetail: mocks.load }));
vi.mock("@/app/_components/shell-wrapper", () => ({ Shell: () => null }));
vi.mock("@/app/campaigns/_components/caption-editor", () => ({ CaptionEditorScreen: () => null }));
vi.mock("@/src/lib/bot-client", () => ({ captionSaveUnavailableReason: () => "No save connection" }));
import CaptionEditorPage from "@/app/campaigns/[slug]/captions/[variant]/edit/page";
import { healthy, failure, success } from "./fixtures/campaign-detail";
const params = (variant: string) => ({ params: Promise.resolve({ slug: "borehole-drilling", variant }) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.load.mockResolvedValue(healthy);
  mocks.notFound.mockImplementation(() => { throw new Error("404"); });
});
describe("caption editor route", () => {
  it.each(["1", "new"])("loads %s through the campaign loader and passes save availability", async (variant) => {
    const page = await CaptionEditorPage(params(variant));
    expect(mocks.load).toHaveBeenCalledWith("borehole-drilling");
    expect(page.props.children.props).toMatchObject({ variant, detail: healthy, saveUnavailableReason: "No save connection" });
  });
  it.each(["0", "-1", "01", "1.5", "unknown"])("rejects malformed variant %s before reading the bot", async (variant) => {
    await expect(CaptionEditorPage(params(variant))).rejects.toThrow("404");
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("only returns 404 when a successful read confirms the campaign is absent", async () => {
    mocks.load.mockResolvedValue({ ...healthy, campaign: success(null) });
    await expect(CaptionEditorPage(params("1"))).rejects.toThrow("404");
  });
  it("passes read failures to the recoverable editor screen", async () => {
    mocks.load.mockResolvedValue({ ...healthy, campaign: failure, preview: failure });
    await CaptionEditorPage(params("1"));
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
