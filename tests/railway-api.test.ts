import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RAILWAY_API_URL, RailwayError, railwayRequest } from "@/src/lib/railway-api";

/**
 * The transport. What matters here is what does NOT come back out of it: a
 * GraphQL error can quote the request, and the request carries the account
 * token, so Railway's words are kept for the log and never put on a screen.
 */

const TOKEN = "railway-account-token";
const fetchMock = vi.fn();

beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

const answer = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

const ask = () => railwayRequest(TOKEN, "query { me { id } }", { a: 1 },
  (data) => (data as { me?: { id?: string } } | null)?.me?.id ?? null);

/** Everything a failure said, so a test can prove the token is in none of it. */
const refusal = async (): Promise<string> => {
  try { await ask(); } catch (error) {
    const railway = error as RailwayError;
    return `${railway.message} ${railway.detail} ${railway.upstream ?? ""}`;
  }
  throw new Error("expected it to be refused");
};

describe("a call", () => {
  it("goes to Railway's API with the account token and the document", async () => {
    fetchMock.mockResolvedValue(answer({ data: { me: { id: "me-1" } } }));
    expect(await ask()).toBe("me-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(RAILWAY_API_URL);
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({ query: "query { me { id } }", variables: { a: 1 } });
  });
});

describe("a call that does not work", () => {
  it("says the credentials were refused when they were", async () => {
    fetchMock.mockResolvedValue(answer({}, 401));
    expect((await refusal())).toMatch(/credentials/);
  });

  it("keeps Railway's own words for the log and not for the screen", async () => {
    fetchMock.mockResolvedValue(answer({ errors: [{ message: `no access to ${TOKEN}` }] }));
    const error = await ask().then(() => null, (reason: RailwayError) => reason);
    expect(error).toBeInstanceOf(RailwayError);
    expect(error?.detail).not.toContain(TOKEN);
    expect(error?.detail).toMatch(/refused a step/);
    expect(error?.upstream).toContain("no access");
  });

  it("refuses a body it cannot read rather than carrying on with nothing", async () => {
    for (const body of [{ data: { me: null } }, { data: null }, {}, null]) {
      fetchMock.mockResolvedValue(answer(body));
      await expect(ask()).rejects.toBeInstanceOf(RailwayError);
    }
  });

  it("refuses a reply that is not JSON at all", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200,
      json: async () => { throw new Error("not json"); } } as unknown as Response);
    await expect(ask()).rejects.toBeInstanceOf(RailwayError);
  });

  it("says the hosting could not be reached when the request itself fails", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const said = await refusal();
    expect(said).toMatch(/could not be reached/);
    expect(said).not.toContain("ECONNRESET");
  });

  it("never puts the account token in what a screen could show", async () => {
    // `detail` is the only string that travels: the provisioner stores it and
    // the route sends it. `upstream` stays in the log by design.
    for (const outcome of [() => fetchMock.mockResolvedValue(answer({}, 403)),
                           () => fetchMock.mockResolvedValue(answer({ errors: [{ message: TOKEN }] })),
                           () => fetchMock.mockResolvedValue(answer({ data: { me: null } })),
                           () => fetchMock.mockRejectedValue(new Error(TOKEN))]) {
      fetchMock.mockReset();
      outcome();
      const error = await ask().then(() => null, (reason: RailwayError) => reason);
      expect(error?.detail).toBeTruthy();
      expect(error?.detail).not.toContain(TOKEN);
    }
  });
});
