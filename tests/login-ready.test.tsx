// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), release: undefined as undefined | ((value: object) => void) }));
vi.mock("@/src/lib/firebase-browser", () => ({ firebaseBrowserAuth: mocks.auth }));
vi.mock("firebase/auth", () => ({}));
import { LoginForm } from "@/app/login/sign-in";
afterEach(cleanup);
it("enables Google sign-in only after the client and SDK are ready", async () => {
  mocks.auth.mockImplementation(() => new Promise(resolve => { mocks.release = resolve; }));
  render(<LoginForm returnTo="/activity" unavailable={false} />);
  expect((screen.getByRole("button", { name: "Preparing sign-in…" }) as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(mocks.auth).toHaveBeenCalledOnce());
  await act(async () => { mocks.release!({}); });
  expect((await screen.findByRole("button", { name: "Continue with Google" }) as HTMLButtonElement).disabled).toBe(false);
});
