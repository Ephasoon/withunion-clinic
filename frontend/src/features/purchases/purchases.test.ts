import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, CLIENT_ERROR_CODES } from "../../api";
import { createPurchase, fetchPurchase, fetchPurchases, receivePurchase } from "./api";
import { createPurchaseErrorMessage, invalidInventoryItemId, receivePurchaseErrorMessage } from "./purchaseErrors";
import {
  buildCreatePurchase,
  draftTotalCents,
  isBlankRow,
  parseQuantity,
  parseUnitCostCents,
  purchaseTotal,
  type PurchaseFormValues,
  type PurchaseItemRow,
} from "./purchaseForm";

const SUPPLIER = "11111111-1111-4111-8111-111111111111";
const ITEM_A = "22222222-2222-4222-8222-222222222222";
const ITEM_B = "33333333-3333-4333-8333-333333333333";

let n = 0;
const row = (inventoryItemId: string, quantity: string, unitCost: string): PurchaseItemRow => ({ key: `r${++n}`, inventoryItemId, quantity, unitCost });
const blank = () => row("", "", "");
const form = (items: PurchaseItemRow[], extra: Partial<PurchaseFormValues> = {}): PurchaseFormValues => ({
  supplierId: SUPPLIER,
  purchaseDate: "2026-09-28",
  referenceNumber: "",
  notes: "",
  items,
  ...extra,
});

describe("quantity and unit cost parsing", () => {
  it("quantity: whole number 1–1,000,000", () => {
    expect(parseQuantity("1")).toBe(1);
    expect(parseQuantity(" 1000000 ")).toBe(1_000_000);
    for (const bad of ["0", "1000001", "1.5", "-1", "1e3", "", "ten", "1,000"]) expect(parseQuantity(bad), bad).toBeNull();
  });

  it("unit cost: 0–10,000,000 with at most 2 decimals, in cents", () => {
    expect(parseUnitCostCents("0")).toBe(0);
    expect(parseUnitCostCents("12.5")).toBe(1250);
    expect(parseUnitCostCents("0.10")).toBe(10);
    expect(parseUnitCostCents("10000000")).toBe(1_000_000_000);
    expect(parseUnitCostCents("10000000.00")).toBe(1_000_000_000);
    for (const bad of ["10000000.01", "-1", "1.234", "", "abc", "1,000"]) expect(parseUnitCostCents(bad), bad).toBeNull();
  });
});

describe("buildCreatePurchase", () => {
  it("builds the exact body: date string untouched, numbers, blank optional fields left out", () => {
    const result = buildCreatePurchase(form([row(ITEM_A, "10", "2.50"), row(ITEM_B, " 3 ", "0")]));
    expect(result).toEqual({
      ok: true,
      body: {
        supplierId: SUPPLIER,
        purchaseDate: "2026-09-28",
        items: [
          { inventoryItemId: ITEM_A, quantity: 10, unitCost: 2.5 },
          { inventoryItemId: ITEM_B, quantity: 3, unitCost: 0 },
        ],
      },
    });
  });

  it("includes trimmed reference number and notes when given", () => {
    const result = buildCreatePurchase(form([row(ITEM_A, "1", "1")], { referenceNumber: " INV-9 ", notes: " boxed " }));
    expect(result.ok && result.body).toMatchObject({ referenceNumber: "INV-9", notes: "boxed" });
  });

  it("passes the purchase date through as the same string (never via Date)", () => {
    for (const date of ["2026-01-01", "2024-02-29", "2026-12-31"]) {
      const result = buildCreatePurchase(form([row(ITEM_A, "1", "1")], { purchaseDate: date }));
      expect(result.ok && result.body.purchaseDate).toBe(date);
    }
    expect(buildCreatePurchase(form([row(ITEM_A, "1", "1")], { purchaseDate: "2026-02-29" }))).toMatchObject({
      ok: false,
      errors: { purchaseDate: "Enter a valid date." },
    });
  });

  it("ignores blank rows", () => {
    const result = buildCreatePurchase(form([blank(), row(ITEM_A, "1", "1"), blank()]));
    expect(result.ok && result.body.items).toHaveLength(1);
    expect(isBlankRow(row("", " ", ""))).toBe(true);
  });

  it("requires at least 1 item", () => {
    expect(buildCreatePurchase(form([]))).toMatchObject({ ok: false, errors: { items: "Add at least one item." } });
    expect(buildCreatePurchase(form([blank(), blank()]))).toMatchObject({ ok: false, errors: { items: "Add at least one item." } });
  });

  it("allows exactly 50 items and refuses 51", () => {
    const fifty = Array.from({ length: 50 }, () => row(ITEM_A, "1", "1"));
    const ok = buildCreatePurchase(form(fifty));
    expect(ok.ok && ok.body.items).toHaveLength(50);
    const result = buildCreatePurchase(form([...fifty, row(ITEM_B, "1", "1")]));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.items).toMatch(/at most 50/);
  });

  it("reports each bad field on its own row", () => {
    const good = row(ITEM_A, "1", "1");
    const bad = row("", "0", "1.999");
    const partial = row(ITEM_B, "", "");
    const result = buildCreatePurchase(form([good, bad, partial]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.rows[good.key]).toBeUndefined();
    expect(Object.keys(result.errors.rows[bad.key]!).sort()).toEqual(["inventoryItemId", "quantity", "unitCost"]);
    expect(result.errors.rows[partial.key]).toEqual({ quantity: "Enter a quantity.", unitCost: "Enter the unit cost (0 if free)." });
  });

  it("enforces quantity and cost limits per row", () => {
    const q = row(ITEM_A, "1000001", "1");
    const c = row(ITEM_A, "1", "10000000.01");
    const result = buildCreatePurchase(form([q, c]));
    expect(!result.ok && result.errors.rows[q.key]?.quantity).toMatch(/1 to 1,000,000/);
    expect(!result.ok && result.errors.rows[c.key]?.unitCost).toMatch(/10,000,000/);
  });

  it("requires a supplier and limits reference number and notes", () => {
    const result = buildCreatePurchase(
      form([row(ITEM_A, "1", "1")], { supplierId: "", referenceNumber: "r".repeat(101), notes: "n".repeat(2001) })
    );
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(["notes", "referenceNumber", "rows", "supplierId"]);
  });
});

describe("totals (in cents, no float drift)", () => {
  it("sums the valid draft rows only", () => {
    expect(draftTotalCents([row(ITEM_A, "3", "0.10"), row(ITEM_B, "x", "5"), blank()])).toBe(30);
  });

  it("sums saved items exactly", () => {
    expect(purchaseTotal([{ quantity: 3, unitCost: 0.1 }, { quantity: 1, unitCost: 0.2 }])).toBe(0.5);
  });
});

describe("purchase error messages", () => {
  const names = new Map([[ITEM_A, "Paracetamol 500mg"]]);

  it("INVALID_INVENTORY_ITEM: names the item and says the whole batch was rolled back", () => {
    const error = new ApiError(400, "INVALID_INVENTORY_ITEM", `Inventory item ${ITEM_A} does not exist`);
    const text = createPurchaseErrorMessage(error, names);
    expect(text).toContain("“Paracetamol 500mg” no longer exists");
    expect(text).toContain("nothing was saved");
    expect(text).toContain("whole purchase was rolled back");
  });

  it("INVALID_INVENTORY_ITEM with an unknown id falls back to the id, or to a generic subject", () => {
    expect(createPurchaseErrorMessage(new ApiError(400, "INVALID_INVENTORY_ITEM", `Inventory item ${ITEM_B} does not exist`))).toContain(`“${ITEM_B}”`);
    expect(createPurchaseErrorMessage(new ApiError(400, "INVALID_INVENTORY_ITEM", "something else"))).toMatch(/^One of the stock items/);
    expect(invalidInventoryItemId(`Inventory item ${ITEM_A} does not exist`)).toBe(ITEM_A);
  });

  it("PURCHASE_ALREADY_RECEIVED on receive", () => {
    const text = receivePurchaseErrorMessage(new ApiError(409, "PURCHASE_ALREADY_RECEIVED", "Purchase is already RECEIVED"));
    expect(text).toMatch(/already been received/);
    expect(text).toMatch(/won’t be added again/);
  });

  it("5xx / network: outcome unknown, never 'try again' blindly", () => {
    expect(createPurchaseErrorMessage(new ApiError(500, "INTERNAL_ERROR", "x"))).toMatch(/didn’t confirm whether this purchase was saved/);
    expect(receivePurchaseErrorMessage(new ApiError(0, CLIENT_ERROR_CODES.NETWORK_ERROR, "x"))).toMatch(/didn’t confirm whether this purchase was received/);
  });

  it("NOT_FOUND and field validation", () => {
    expect(createPurchaseErrorMessage(new ApiError(404, "NOT_FOUND", "Supplier not found"))).toMatch(/supplier no longer exists/);
    expect(receivePurchaseErrorMessage(new ApiError(404, "NOT_FOUND", "Purchase not found"))).toBe("This purchase no longer exists.");
    expect(
      createPurchaseErrorMessage(new ApiError(400, "VALIDATION_ERROR", "Invalid request body", { items: ["at least one item is required"] }))
    ).toBe("Items: at least one item is required");
  });
});

describe("purchases API requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(data: unknown) {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data, error: null, meta: null }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const call = (fetchMock: ReturnType<typeof stubFetch>) => {
    const [url, init] = fetchMock.mock.calls[0]!;
    return { url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body as string) : undefined };
  };

  it("GET /api/v1/purchases and /api/v1/purchases/:id", async () => {
    let fetchMock = stubFetch({ purchases: [] });
    await expect(fetchPurchases()).resolves.toEqual([]);
    expect(call(fetchMock)).toEqual({ url: "/api/v1/purchases", method: "GET", body: undefined });
    fetchMock = stubFetch({ purchase: { id: "p1" } });
    await expect(fetchPurchase("p1")).resolves.toEqual({ id: "p1" });
    expect(call(fetchMock).url).toBe("/api/v1/purchases/p1");
  });

  it("POST /api/v1/purchases with exactly the built body", async () => {
    const built = buildCreatePurchase(form([row(ITEM_A, "10", "2.50")], { referenceNumber: "INV-1" }));
    if (!built.ok) throw new Error("expected a valid form");
    const fetchMock = stubFetch({ purchase: { id: "p1" } });
    await createPurchase(built.body);
    expect(call(fetchMock)).toEqual({
      url: "/api/v1/purchases",
      method: "POST",
      body: {
        supplierId: SUPPLIER,
        purchaseDate: "2026-09-28",
        referenceNumber: "INV-1",
        items: [{ inventoryItemId: ITEM_A, quantity: 10, unitCost: 2.5 }],
      },
    });
  });

  it("POST /api/v1/purchases/:id/receive with no body", async () => {
    const fetchMock = stubFetch({ purchase: { id: "p1", status: "RECEIVED" } });
    await receivePurchase("p1");
    expect(call(fetchMock)).toEqual({ url: "/api/v1/purchases/p1/receive", method: "POST", body: undefined });
  });
});
