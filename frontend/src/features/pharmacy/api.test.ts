import { afterEach, describe, expect, it, vi } from "vitest";
import { createInventoryItem, fetchInventory } from "../inventory/api";
import { completePharmacy, dispenseItems, fetchPharmacyQueue, fetchPrescription, startPharmacy } from "./api";

/** The exact requests the pharmacy and inventory API functions send, against docs/api-inventory.md §5.8–5.9. */

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

describe("pharmacy API requests", () => {
  it("fetchPharmacyQueue: GET /api/v1/pharmacy/prescriptions", async () => {
    const fetchMock = stubFetch({ prescriptions: [] });
    await fetchPharmacyQueue();
    expect(call(fetchMock)).toEqual({ url: "/api/v1/pharmacy/prescriptions", method: "GET", body: undefined });
  });

  it("fetchPrescription: GET /api/v1/pharmacy/prescriptions/:id", async () => {
    const fetchMock = stubFetch({ prescription: { id: "p1" } });
    await fetchPrescription("p1");
    expect(call(fetchMock).url).toBe("/api/v1/pharmacy/prescriptions/p1");
  });

  it("startPharmacy: POST …/start with no body — never the generic transition", async () => {
    const fetchMock = stubFetch({ prescription: { id: "p1" } });
    await startPharmacy("p1");
    expect(call(fetchMock)).toEqual({ url: "/api/v1/pharmacy/prescriptions/p1/start", method: "POST", body: undefined });
  });

  it("dispenseItems: POST …/dispense { items } with both entry shapes", async () => {
    const fetchMock = stubFetch({ prescription: { id: "p1" } });
    await dispenseItems("p1", [
      { itemId: "i1", inventoryItemId: "s1", quantity: 5 },
      { itemId: "i2", markUnavailable: true },
    ]);
    expect(call(fetchMock)).toEqual({
      url: "/api/v1/pharmacy/prescriptions/p1/dispense",
      method: "POST",
      body: {
        items: [
          { itemId: "i1", inventoryItemId: "s1", quantity: 5 },
          { itemId: "i2", markUnavailable: true },
        ],
      },
    });
  });

  it("completePharmacy: POST …/complete with no body — never WAITING_FOR_BILLING through the generic transition", async () => {
    const fetchMock = stubFetch({ prescription: { id: "p1" }, visitStatus: "WAITING_FOR_BILLING" });
    const result = await completePharmacy("p1");
    expect(call(fetchMock)).toEqual({ url: "/api/v1/pharmacy/prescriptions/p1/complete", method: "POST", body: undefined });
    expect(result.visitStatus).toBe("WAITING_FOR_BILLING");
  });
});

describe("inventory API requests", () => {
  it("fetchInventory: GET /api/v1/inventory/items", async () => {
    const fetchMock = stubFetch({ items: [] });
    await fetchInventory();
    expect(call(fetchMock)).toEqual({ url: "/api/v1/inventory/items", method: "GET", body: undefined });
  });

  it("createInventoryItem: POST /api/v1/inventory/items { name, unit, quantityOnHand }", async () => {
    const fetchMock = stubFetch({ item: { id: "s1" } });
    await createInventoryItem({ name: "ORS", unit: "sachet", quantityOnHand: 40 });
    expect(call(fetchMock)).toEqual({
      url: "/api/v1/inventory/items",
      method: "POST",
      body: { name: "ORS", unit: "sachet", quantityOnHand: 40 },
    });
  });
});
