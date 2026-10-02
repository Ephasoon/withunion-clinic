import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, CLIENT_ERROR_CODES } from "../../api";
import { createPriceListItem, fetchPriceList, fetchPriceListItem, updatePriceListItem } from "./api";
import { priceListErrorMessage } from "./priceListErrors";
import {
  buildCreatePriceListItem,
  buildPriceListPatch,
  EMPTY_PRICE_LIST_ITEM,
  NO_CHANGES_MESSAGE,
  priceListValues,
  validatePriceListValues,
} from "./priceListForm";
import type { PriceListItem } from "./types";

const ITEM: PriceListItem = {
  id: "p1",
  name: "Consultation",
  price: 250.5,
  isActive: true,
  createdBy: "u1",
  createdAt: "2026-10-01T08:00:00.000Z",
  updatedAt: "2026-10-01T08:00:00.000Z",
};
const draftOf = (item: PriceListItem) => ({ ...priceListValues(item), isActive: item.isActive });

describe("validatePriceListValues / buildCreatePriceListItem", () => {
  it("requires a name and trims it", () => {
    expect(validatePriceListValues(EMPTY_PRICE_LIST_ITEM).name).toMatch(/name/);
    expect(validatePriceListValues({ name: "   ", price: "1" }).name).toBeDefined();
    expect(buildCreatePriceListItem({ name: "  Consultation ", price: "250.50" })).toEqual({
      ok: true,
      body: { name: "Consultation", price: 250.5 },
    });
  });

  it("enforces the backend's name length limit", () => {
    expect(validatePriceListValues({ name: "n".repeat(256), price: "1" }).name).toMatch(/255/);
    expect(validatePriceListValues({ name: "n".repeat(255), price: "1" })).toEqual({});
  });

  it("accepts 0 to 10,000,000 with at most 2 decimals", () => {
    expect(validatePriceListValues({ name: "A", price: "0" })).toEqual({});
    expect(validatePriceListValues({ name: "A", price: "10000000" })).toEqual({});
    expect(validatePriceListValues({ name: "A", price: "0.29" })).toEqual({});
    expect(validatePriceListValues({ name: "A", price: "10000000.01" }).price).toMatch(/10,000,000/);
    expect(validatePriceListValues({ name: "A", price: "12.345" }).price).toMatch(/150.50/);
    expect(validatePriceListValues({ name: "A", price: "-1" }).price).toBeDefined();
    expect(validatePriceListValues({ name: "A", price: "1,000" }).price).toBeDefined();
    expect(validatePriceListValues({ name: "A", price: "" }).price).toMatch(/Enter the price/);
  });

  it("sends the price as a 2 dp number, never a string", () => {
    expect(buildCreatePriceListItem({ name: "A", price: "0.29" })).toEqual({ ok: true, body: { name: "A", price: 0.29 } });
    expect(buildCreatePriceListItem({ name: "A", price: "150" })).toEqual({ ok: true, body: { name: "A", price: 150 } });
  });
});

describe("buildPriceListPatch", () => {
  it("starts from the item's values, the price shown with 2 decimals", () => {
    expect(priceListValues(ITEM)).toEqual({ name: "Consultation", price: "250.50" });
  });

  it("sends only the one field that changed", () => {
    expect(buildPriceListPatch(ITEM, { ...draftOf(ITEM), price: "300" })).toEqual({ ok: true, body: { price: 300 } });
    expect(buildPriceListPatch(ITEM, { ...draftOf(ITEM), isActive: false })).toEqual({ ok: true, body: { isActive: false } });
    expect(buildPriceListPatch(ITEM, { ...draftOf(ITEM), name: "Review" })).toEqual({ ok: true, body: { name: "Review" } });
  });

  it("treats an equal price in other notation and whitespace-only name edits as no change", () => {
    const result = buildPriceListPatch(ITEM, { ...draftOf(ITEM), name: " Consultation  ", price: "250.5" });
    expect(result).toEqual({ ok: false, errors: {}, message: NO_CHANGES_MESSAGE });
  });

  it("sends a re-cased name (the backend allows an item to re-case its own name)", () => {
    expect(buildPriceListPatch(ITEM, { ...draftOf(ITEM), name: "CONSULTATION" })).toEqual({ ok: true, body: { name: "CONSULTATION" } });
  });

  it("refuses an empty patch with the 'at least one field' message", () => {
    expect(buildPriceListPatch(ITEM, draftOf(ITEM))).toEqual({ ok: false, errors: {}, message: NO_CHANGES_MESSAGE });
  });

  it("sends several changed fields together", () => {
    expect(buildPriceListPatch(ITEM, { name: "Review", price: "100.25", isActive: false })).toEqual({
      ok: true,
      body: { name: "Review", price: 100.25, isActive: false },
    });
  });

  it("reports field errors before looking for changes", () => {
    const result = buildPriceListPatch(ITEM, { ...draftOf(ITEM), price: "1.001" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.price).toBeDefined();
  });
});

describe("priceListErrorMessage", () => {
  it("explains PRICE_LIST_ITEM_ALREADY_EXISTS on create and update", () => {
    const error = new ApiError(409, "PRICE_LIST_ITEM_ALREADY_EXISTS", 'A price list item named "X" already exists');
    expect(priceListErrorMessage(error, "create")).toMatch(/already exists.*ignoring case and spacing/);
    expect(priceListErrorMessage(error, "update")).toMatch(/already exists/);
  });

  it("PATCH refine without a path (details {}) → the change-something message, not the generic one", () => {
    const error = new ApiError(400, "VALIDATION_ERROR", "Invalid request body", {});
    expect(priceListErrorMessage(error, "update")).toBe(NO_CHANGES_MESSAGE);
  });

  it("the same empty details on create → generic validation text", () => {
    const error = new ApiError(400, "VALIDATION_ERROR", "Invalid request body", {});
    expect(priceListErrorMessage(error, "create")).toMatch(/not valid/);
  });

  it("shows field details with labels", () => {
    const error = new ApiError(400, "VALIDATION_ERROR", "Invalid request body", { price: ["price must have at most 2 decimal places"] });
    expect(priceListErrorMessage(error, "create")).toBe("Price: price must have at most 2 decimal places");
  });

  it("NOT_FOUND and network errors", () => {
    expect(priceListErrorMessage(new ApiError(404, "NOT_FOUND", "Price list item not found"), "update")).toBe(
      "This price list item no longer exists."
    );
    expect(priceListErrorMessage(new ApiError(0, CLIENT_ERROR_CODES.NETWORK_ERROR, "x"), "create")).toMatch(/Could not reach/);
  });
});

describe("price list API requests", () => {
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

  it("GET /api/v1/price-list and /api/v1/price-list/:id", async () => {
    let fetchMock = stubFetch({ items: [ITEM] });
    await expect(fetchPriceList()).resolves.toEqual([ITEM]);
    expect(call(fetchMock)).toEqual({ url: "/api/v1/price-list", method: "GET", body: undefined });
    fetchMock = stubFetch({ item: ITEM });
    await expect(fetchPriceListItem("p1")).resolves.toEqual(ITEM);
    expect(call(fetchMock).url).toBe("/api/v1/price-list/p1");
  });

  it("POST /api/v1/price-list with the built body", async () => {
    const fetchMock = stubFetch({ item: ITEM });
    await createPriceListItem({ name: "Consultation", price: 250.5 });
    expect(call(fetchMock)).toEqual({ url: "/api/v1/price-list", method: "POST", body: { name: "Consultation", price: 250.5 } });
  });

  it("PATCH /api/v1/price-list/:id with only the changed field", async () => {
    const fetchMock = stubFetch({ item: ITEM });
    await updatePriceListItem("p1", { isActive: false });
    expect(call(fetchMock)).toEqual({ url: "/api/v1/price-list/p1", method: "PATCH", body: { isActive: false } });
  });
});
