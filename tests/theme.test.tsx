// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_COOKIE_MAX_AGE_SECONDS, THEME_COOKIE_NAME } from "@/src/config";
import { DEFAULT_THEME, isTheme, themeAttribute } from "@/src/lib/theme";

const mock = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  set: vi.fn(),
  revalidate: vi.fn(),
  save: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "genaie_console_theme" && mock.cookie !== undefined ? { value: mock.cookie } : undefined),
    set: mock.set,
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidate }));
// The form is tested against a stand-in; the action itself is loaded for real below.
vi.mock("@/app/settings/actions", () => ({ setThemeAction: mock.save }));

import { displayTheme } from "@/src/lib/display-theme";
import RootLayout from "@/app/layout";
import { AppearanceForm } from "@/app/settings/_components/appearance-form";

const realActions = () => vi.importActual<typeof import("@/app/settings/actions")>("@/app/settings/actions");
const root = () => document.documentElement;

beforeEach(() => {
  mock.cookie = undefined;
});

afterEach(() => {
  cleanup();
  delete root().dataset.theme;
  mock.set.mockReset();
  mock.revalidate.mockReset();
  mock.save.mockReset();
});

describe("the two themes", () => {
  it("knows light and dark and nothing else", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    for (const junk of ["", "Dark", "system", "auto", undefined, null, 1]) expect(isTheme(junk)).toBe(false);
  });

  it("is light until someone chooses otherwise", () => {
    expect(DEFAULT_THEME).toBe("light");
  });

  it("marks only dark on the root element, since light is the stylesheet's own :root", () => {
    expect(themeAttribute("dark")).toBe("dark");
    expect(themeAttribute("light")).toBeUndefined();
  });
});

describe("reading the choice on the server", () => {
  it("reads light with no cookie, and light from a cookie it does not recognise", async () => {
    await expect(displayTheme()).resolves.toBe("light");
    mock.cookie = "midnight";
    await expect(displayTheme()).resolves.toBe("light");
  });

  it("reads dark from the cookie", async () => {
    mock.cookie = "dark";
    await expect(displayTheme()).resolves.toBe("dark");
  });

  it("paints the root element dark from the first frame, and light with no attribute", async () => {
    mock.cookie = "dark";
    const dark = await RootLayout({ children: null });
    expect(dark.props["data-theme"]).toBe("dark");
    mock.cookie = undefined;
    const light = await RootLayout({ children: null });
    expect(light.props["data-theme"]).toBeUndefined();
  });
});

describe("saving the choice", () => {
  it("refuses a theme the console does not offer and sets no cookie", async () => {
    const { setThemeAction } = await realActions();
    await expect(setThemeAction("system")).resolves.toMatchObject({ ok: false });
    expect(mock.set).not.toHaveBeenCalled();
    expect(mock.revalidate).not.toHaveBeenCalled();
  });

  it("keeps the choice in this browser for a year and re-renders every screen", async () => {
    const { setThemeAction } = await realActions();
    await expect(setThemeAction("dark")).resolves.toEqual({ ok: true });
    expect(mock.set).toHaveBeenCalledWith(THEME_COOKIE_NAME, "dark", {
      maxAge: THEME_COOKIE_MAX_AGE_SECONDS, sameSite: "lax", path: "/",
    });
    expect(mock.revalidate).toHaveBeenCalledWith("/", "layout");
  });
});

describe("the Appearance card", () => {
  function pick(value: string) {
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value } });
  }

  it("turns dark at once, before the save comes back", async () => {
    let finish!: (outcome: { ok: true }) => void;
    mock.save.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<AppearanceForm theme="light" />);

    pick("dark");
    expect(root().dataset.theme).toBe("dark");
    expect(mock.save).toHaveBeenCalledWith("dark");

    await act(async () => finish({ ok: true }));
    expect(screen.getByRole("status").textContent).toBe("Saved. The console now shows dark.");
  });

  it("turns light by taking the attribute away", async () => {
    mock.save.mockResolvedValue({ ok: true });
    root().dataset.theme = "dark";
    render(<AppearanceForm theme="dark" />);

    pick("light");
    expect(root().hasAttribute("data-theme")).toBe(false);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved. The console now shows light."));
  });

  it("goes back to the old theme when the save is refused, and says why", async () => {
    mock.save.mockResolvedValue({ ok: false, detail: "That is not one of the themes the console offers." });
    render(<AppearanceForm theme="light" />);

    pick("dark");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("That is not one of the themes the console offers."));
    expect(root().hasAttribute("data-theme")).toBe(false);
    expect((screen.getByLabelText("Theme") as HTMLSelectElement).value).toBe("light");
  });

  it("goes back to the old theme when the save never arrives", async () => {
    mock.save.mockRejectedValue(new Error("offline"));
    root().dataset.theme = "dark";
    render(<AppearanceForm theme="dark" />);

    pick("light");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The theme could not be saved. Try again."));
    expect(root().dataset.theme).toBe("dark");
  });

  it("does nothing when the theme already shown is picked again", () => {
    render(<AppearanceForm theme="light" />);
    pick("light");
    expect(mock.save).not.toHaveBeenCalled();
  });
});

describe("the stylesheet's dark block", () => {
  const css = readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  function tokens(selector: string): Map<string, string> {
    const start = css.indexOf(`${selector} {`);
    expect(start, `${selector} is missing from globals.css`).toBeGreaterThanOrEqual(0);
    const body = css.slice(start, css.indexOf("\n}", start));
    return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
  }

  // Sizes and type are the same by day and night; everything else is a colour,
  // a shadow or a filter, and must say what it is at night.
  const SAME_IN_BOTH = /^--(font-|radius|sidebar-)/;
  const light = tokens("\n:root");
  const dark = tokens(':root[data-theme="dark"]');

  it("redeclares every light colour token, so none can ship without its night twin", () => {
    const missing = [...light.keys()].filter((name) => !SAME_IN_BOTH.test(name) && !dark.has(name));
    expect(missing).toEqual([]);
  });

  it("declares nothing light does not, so a misspelt token cannot hide there", () => {
    expect([...dark.keys()].filter((name) => !light.has(name))).toEqual([]);
  });

  it("darkens the browser's own controls along with the page", () => {
    const start = css.indexOf(':root[data-theme="dark"] {');
    expect(css.slice(start, css.indexOf("\n}", start))).toContain("color-scheme: dark;");
  });
});
