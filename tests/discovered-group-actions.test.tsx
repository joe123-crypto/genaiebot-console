// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DiscoveredGroupActions } from "@/app/groups/_components/discovered-group-actions";
import { LiveGroups } from "@/app/groups/_components/live-groups";
import { DEFAULT_GROUP_FILTER } from "@/src/domains/group-filter";
import type { LivePage } from "@/src/lib/live-types";
import type { Group } from "@/src/lib/types";
import type { WriteOutcome } from "@/src/lib/write-outcome";

const remove = vi.hoisted(() => vi.fn());
vi.mock("@/app/groups/actions", () => ({ addDiscoveredGroupAction: vi.fn(), removeDiscoveredGroupAction: remove }));

const stamp = "2026-11-08T06:00:00.000Z";
const props = {
  jid: "120363111@g.us", label: "Harare Market", lastSeenAt: stamp,
  addGate: { allowed: true } as const, removeGate: { allowed: true } as const,
};

function openRemoval() {
  fireEvent.click(screen.getByRole("button", { name: "Remove Harare Market from Unassigned" }));
  return within(screen.getByRole("alertdialog"));
}

afterEach(() => { cleanup(); remove.mockReset(); vi.unstubAllGlobals(); });

it("cancels safely, disables both actions in flight and keeps a failed removal open", async () => {
  let finish!: (outcome: WriteOutcome) => void;
  remove.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ ok: true });
  render(<DiscoveredGroupActions {...props} />);
  let dialog = openRemoval();
  expect(dialog.getByText(/later WhatsApp scan can bring the group back/)).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
  expect(remove).not.toHaveBeenCalled();
  dialog = openRemoval();
  fireEvent.click(dialog.getByRole("button", { name: "Remove from Unassigned" }));
  expect(remove).toHaveBeenCalledExactlyOnceWith(props.jid, stamp);
  expect((screen.getByRole("button", { name: /Add Harare Market/ }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: /Remove Harare Market/ }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish({ ok: false, detail: "Try again." }));
  expect(dialog.getByRole("alert").textContent).toContain("Try again.");
  await act(async () => fireEvent.click(dialog.getByRole("button", { name: "Remove from Unassigned" })));
  expect(remove).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("requires the operator to reopen the dialog after a newer observation", () => {
  const view = render(<DiscoveredGroupActions {...props} />);
  const dialog = openRemoval();
  view.rerender(<DiscoveredGroupActions {...props} lastSeenAt="2026-11-08T07:00:00.000Z" />);
  expect(dialog.getByRole("alert").textContent).toContain("observation changed");
  const confirm = dialog.getByRole<HTMLButtonElement>("button", { name: "Remove from Unassigned" });
  expect(confirm.disabled).toBe(true);
  fireEvent.click(confirm);
  expect(remove).not.toHaveBeenCalled();
});

it("refreshes Unassigned with the server total and reflects removal on a fresh visit", async () => {
  const sync = { state: "live" as const, revision: "1", syncedAt: stamp, stale: false };
  const initial: LivePage<Group> = { sync, revision: "1", rows: [], total: 0, context: {
    accounts: [], actions: { leaveGroup: true, clearRecords: true, removeDiscovery: true },
  } };
  const group = { jid: props.jid, name: props.label, firstSeenAt: stamp, lastSeenAt: stamp, accounts: [] };
  let removed = false;
  remove.mockImplementation(async () => { removed = true; return { ok: true }; });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.startsWith("/api/live/discoveries?")) {
      return Response.json({ sync, revision: removed ? "2" : "1", rows: removed ? [] : [group], total: removed ? 11 : 12 });
    }
    return Response.json(initial);
  }));
  const page = <LiveGroups initial={initial} filter={DEFAULT_GROUP_FILTER} writable />;
  const view = render(page);
  await screen.findByRole("heading", { name: "Unassigned 12" });
  fireEvent.click(screen.getByRole("button", { name: "Unassigned 12" }));
  const dialog = openRemoval();
  await act(async () => fireEvent.click(dialog.getByRole("button", { name: "Remove from Unassigned" })));
  await screen.findByRole("heading", { name: "Unassigned 11" });
  expect(screen.queryByText(props.label)).toBeNull();
  view.unmount();
  render(page);
  await screen.findByRole("heading", { name: "Unassigned 11" });
  expect(screen.queryByText(props.label)).toBeNull();
});
