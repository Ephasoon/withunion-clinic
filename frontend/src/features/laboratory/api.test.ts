import { afterEach, describe, expect, it, vi } from "vitest";
import { completeLabOrder, enterLabResults, fetchLabOrder, fetchLabQueue, startLabOrder } from "./api";

/** The exact requests the lab API functions send, against docs/api-inventory.md §5.7. */

function stubFetch(data: unknown) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({ data, error: null, meta: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const call = (fetchMock: ReturnType<typeof stubFetch>) => {
  const [url, init] = fetchMock.mock.calls[0]!;
  return { url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body as string) : undefined };
};

afterEach(() => vi.unstubAllGlobals());

describe("lab API requests", () => {
  it("fetchLabQueue: GET /api/v1/laboratory/orders", async () => {
    const fetchMock = stubFetch({ orders: [] });
    await fetchLabQueue();
    expect(call(fetchMock)).toEqual({ url: "/api/v1/laboratory/orders", method: "GET", body: undefined });
  });

  it("fetchLabOrder: GET /api/v1/laboratory/orders/:id", async () => {
    const fetchMock = stubFetch({ order: { id: "o1" } });
    await fetchLabOrder("o1");
    expect(call(fetchMock)).toEqual({ url: "/api/v1/laboratory/orders/o1", method: "GET", body: undefined });
  });

  it("startLabOrder: POST …/start with no body — never the generic transition", async () => {
    const fetchMock = stubFetch({ order: { id: "o1" } });
    await startLabOrder("o1");
    expect(call(fetchMock)).toEqual({ url: "/api/v1/laboratory/orders/o1/start", method: "POST", body: undefined });
    expect(call(fetchMock).url).not.toContain("/transition");
  });

  it("enterLabResults: POST …/results { results: [{ itemId, result }] }", async () => {
    const fetchMock = stubFetch({ order: { id: "o1" } });
    await enterLabResults("o1", [{ itemId: "i1", result: "Normal" }]);
    expect(call(fetchMock)).toEqual({
      url: "/api/v1/laboratory/orders/o1/results",
      method: "POST",
      body: { results: [{ itemId: "i1", result: "Normal" }] },
    });
  });

  it("completeLabOrder: POST …/complete with no body — never LAB_COMPLETED through the generic transition", async () => {
    const fetchMock = stubFetch({ order: { id: "o1" } });
    await completeLabOrder("o1");
    expect(call(fetchMock)).toEqual({ url: "/api/v1/laboratory/orders/o1/complete", method: "POST", body: undefined });
  });
});
