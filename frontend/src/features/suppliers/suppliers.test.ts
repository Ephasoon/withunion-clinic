import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, CLIENT_ERROR_CODES } from "../../api";
import { createSupplier, fetchSupplier, fetchSuppliers, updateSupplier } from "./api";
import { supplierErrorMessage } from "./supplierErrors";
import { buildCreateSupplier, buildSupplierPatch, EMPTY_SUPPLIER, NO_CHANGES_MESSAGE, supplierValues, validateSupplierValues } from "./supplierForm";
import type { Supplier } from "./types";

const SUPPLIER: Supplier = {
  id: "s1",
  name: "Acme Pharma",
  contactPerson: "Juma",
  phone: null,
  email: "orders@acme.test",
  address: null,
  isActive: true,
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-01T08:00:00.000Z",
};
const draftOf = (s: Supplier) => ({ ...supplierValues(s), isActive: s.isActive });

describe("validateSupplierValues / buildCreateSupplier", () => {
  it("requires a name and trims it; no uniqueness check", () => {
    expect(validateSupplierValues(EMPTY_SUPPLIER).name).toMatch(/name/);
    expect(validateSupplierValues({ ...EMPTY_SUPPLIER, name: "   " }).name).toBeDefined();
    expect(buildCreateSupplier({ ...EMPTY_SUPPLIER, name: "  Acme Pharma " })).toEqual({ ok: true, body: { name: "Acme Pharma" } });
  });

  it("enforces the backend's length limits", () => {
    const e = validateSupplierValues({
      name: "n".repeat(256),
      contactPerson: "c".repeat(256),
      phone: "1".repeat(33),
      email: "",
      address: "a".repeat(2001),
    });
    expect(Object.keys(e).sort()).toEqual(["address", "contactPerson", "name", "phone"]);
    expect(
      validateSupplierValues({ name: "n".repeat(255), contactPerson: "c".repeat(255), phone: "1".repeat(32), email: "", address: "a".repeat(2000) })
    ).toEqual({});
  });

  it("checks the email shape only when one is entered", () => {
    expect(validateSupplierValues({ ...EMPTY_SUPPLIER, name: "A", email: "not-an-email" }).email).toMatch(/valid email/);
    expect(validateSupplierValues({ ...EMPTY_SUPPLIER, name: "A", email: " a@b.co " })).toEqual({});
  });

  it("includes only the optional fields that were filled in, trimmed", () => {
    const result = buildCreateSupplier({ name: "Acme", contactPerson: " Juma ", phone: "", email: "a@b.co", address: "  " });
    expect(result).toEqual({ ok: true, body: { name: "Acme", contactPerson: "Juma", email: "a@b.co" } });
  });
});

describe("buildSupplierPatch", () => {
  it("sends only the one field that changed", () => {
    expect(buildSupplierPatch(SUPPLIER, { ...draftOf(SUPPLIER), phone: "0700 000 000" })).toEqual({ ok: true, body: { phone: "0700 000 000" } });
    expect(buildSupplierPatch(SUPPLIER, { ...draftOf(SUPPLIER), isActive: false })).toEqual({ ok: true, body: { isActive: false } });
    expect(buildSupplierPatch(SUPPLIER, { ...draftOf(SUPPLIER), name: "Acme Ltd" })).toEqual({ ok: true, body: { name: "Acme Ltd" } });
  });

  it("treats whitespace-only edits as no change (the backend trims)", () => {
    const result = buildSupplierPatch(SUPPLIER, { ...draftOf(SUPPLIER), name: " Acme Pharma  ", phone: "   " });
    expect(result).toEqual({ ok: false, errors: {}, message: NO_CHANGES_MESSAGE });
  });

  it("refuses an empty patch with the 'at least one field' message", () => {
    expect(buildSupplierPatch(SUPPLIER, draftOf(SUPPLIER))).toEqual({ ok: false, errors: {}, message: NO_CHANGES_MESSAGE });
  });

  it("sends several changed fields together", () => {
    expect(buildSupplierPatch(SUPPLIER, { ...draftOf(SUPPLIER), contactPerson: "Wanjiru", address: "Moi Ave", isActive: false })).toEqual({
      ok: true,
      body: { contactPerson: "Wanjiru", address: "Moi Ave", isActive: false },
    });
  });

  it("clears contact/phone/address with an empty string (null is not accepted)", () => {
    expect(buildSupplierPatch(SUPPLIER, { ...draftOf(SUPPLIER), contactPerson: "" })).toEqual({ ok: true, body: { contactPerson: "" } });
  });

  it("refuses removing an existing email, but allows changing it or adding one", () => {
    const removed = buildSupplierPatch(SUPPLIER, { ...draftOf(SUPPLIER), email: "  " });
    expect(removed.ok).toBe(false);
    expect(!removed.ok && removed.errors.email).toMatch(/can’t|not removed|changed but not removed/);
    expect(buildSupplierPatch(SUPPLIER, { ...draftOf(SUPPLIER), email: "new@acme.test" })).toEqual({ ok: true, body: { email: "new@acme.test" } });
    const noEmail = { ...SUPPLIER, email: null };
    expect(buildSupplierPatch(noEmail, { ...draftOf(noEmail), email: "a@b.co" })).toEqual({ ok: true, body: { email: "a@b.co" } });
    expect(buildSupplierPatch(noEmail, { ...draftOf(noEmail), email: "" })).toMatchObject({ ok: false, message: NO_CHANGES_MESSAGE });
  });

  it("reports field errors before looking for changes", () => {
    const result = buildSupplierPatch(SUPPLIER, { ...draftOf(SUPPLIER), name: "" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.name).toBeDefined();
  });
});

describe("supplierErrorMessage", () => {
  it("PATCH refine without a path (details {}) → the change-something message, not the generic one", () => {
    const error = new ApiError(400, "VALIDATION_ERROR", "Invalid request body", {});
    expect(supplierErrorMessage(error, "update")).toBe(NO_CHANGES_MESSAGE);
  });

  it("the same empty details on create → generic validation text", () => {
    const error = new ApiError(400, "VALIDATION_ERROR", "Invalid request body", {});
    expect(supplierErrorMessage(error, "create")).toMatch(/not valid/);
  });

  it("shows field details with labels", () => {
    const error = new ApiError(400, "VALIDATION_ERROR", "Invalid request body", { email: ["must be a valid email"] });
    expect(supplierErrorMessage(error, "update")).toBe("Email: must be a valid email");
  });

  it("NOT_FOUND and network errors", () => {
    expect(supplierErrorMessage(new ApiError(404, "NOT_FOUND", "Supplier not found"), "update")).toBe("This supplier no longer exists.");
    expect(supplierErrorMessage(new ApiError(0, CLIENT_ERROR_CODES.NETWORK_ERROR, "x"), "create")).toMatch(/Could not reach/);
  });
});

describe("suppliers API requests", () => {
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

  it("GET /api/v1/suppliers and /api/v1/suppliers/:id", async () => {
    let fetchMock = stubFetch({ suppliers: [SUPPLIER] });
    await expect(fetchSuppliers()).resolves.toEqual([SUPPLIER]);
    expect(call(fetchMock)).toEqual({ url: "/api/v1/suppliers", method: "GET", body: undefined });
    fetchMock = stubFetch({ supplier: SUPPLIER });
    await expect(fetchSupplier("s1")).resolves.toEqual(SUPPLIER);
    expect(call(fetchMock).url).toBe("/api/v1/suppliers/s1");
  });

  it("POST /api/v1/suppliers with the built body", async () => {
    const fetchMock = stubFetch({ supplier: SUPPLIER });
    await createSupplier({ name: "Acme", email: "a@b.co" });
    expect(call(fetchMock)).toEqual({ url: "/api/v1/suppliers", method: "POST", body: { name: "Acme", email: "a@b.co" } });
  });

  it("PATCH /api/v1/suppliers/:id with only the changed field", async () => {
    const fetchMock = stubFetch({ supplier: SUPPLIER });
    await updateSupplier("s1", { isActive: false });
    expect(call(fetchMock)).toEqual({ url: "/api/v1/suppliers/s1", method: "PATCH", body: { isActive: false } });
  });
});
