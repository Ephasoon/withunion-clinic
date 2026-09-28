import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchReceipt, openReceiptPrint, receiptPrintUrl } from "../receipts/api";
import {
  addInvoiceItems,
  completeBilling,
  createInvoice,
  fetchBillingWork,
  fetchInvoice,
  fetchVisitInvoice,
  recordPayment,
} from "./api";

/** The exact requests the billing and receipt API functions send, against docs/api-inventory.md §5.10–5.11. */

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

describe("billing reads", () => {
  it("fetchBillingWork: GET /api/v1/billing/invoices, reads the work key", async () => {
    const fetchMock = stubFetch({ work: [{ visitId: "v1", invoice: null }] });
    const work = await fetchBillingWork();
    expect(call(fetchMock)).toEqual({ url: "/api/v1/billing/invoices", method: "GET", body: undefined });
    expect(work[0]?.invoice).toBeNull();
  });

  it("fetchInvoice: GET /api/v1/billing/invoices/:id", async () => {
    const fetchMock = stubFetch({ invoice: { id: "i1" } });
    await fetchInvoice("i1");
    expect(call(fetchMock).url).toBe("/api/v1/billing/invoices/i1");
  });

  it("fetchVisitInvoice: GET /api/v1/visits/:id/invoice, null when none yet", async () => {
    const fetchMock = stubFetch({ invoice: null });
    expect(await fetchVisitInvoice("v1")).toBeNull();
    expect(call(fetchMock).url).toBe("/api/v1/visits/v1/invoice");
  });
});

describe("billing writes", () => {
  it("createInvoice: POST /api/v1/billing/visits/:visitId/invoice with no body (no discount)", async () => {
    const fetchMock = stubFetch({ invoice: { id: "i1" } });
    await createInvoice("v1");
    expect(call(fetchMock)).toEqual({ url: "/api/v1/billing/visits/v1/invoice", method: "POST", body: undefined });
  });

  it("addInvoiceItems: POST …/items { items }", async () => {
    const fetchMock = stubFetch({ invoice: { id: "i1" } });
    await addInvoiceItems("i1", [{ description: "Consultation", quantity: 1, unitPrice: 150 }]);
    expect(call(fetchMock)).toEqual({
      url: "/api/v1/billing/invoices/i1/items",
      method: "POST",
      body: { items: [{ description: "Consultation", quantity: 1, unitPrice: 150 }] },
    });
  });

  it("recordPayment: POST …/payments { amount, method }", async () => {
    const fetchMock = stubFetch({ invoice: { id: "i1" } });
    await recordPayment("i1", { amount: 75.5, method: "bank_transfer" });
    expect(call(fetchMock)).toEqual({
      url: "/api/v1/billing/invoices/i1/payments",
      method: "POST",
      body: { amount: 75.5, method: "bank_transfer" },
    });
  });

  it("completeBilling: POST …/complete with no body — never the generic transition", async () => {
    const fetchMock = stubFetch({ invoice: { id: "i1" }, visitStatus: "COMPLETED" });
    const result = await completeBilling("i1");
    expect(call(fetchMock)).toEqual({ url: "/api/v1/billing/invoices/i1/complete", method: "POST", body: undefined });
    expect(call(fetchMock).url).not.toContain("/transition");
    expect(result.visitStatus).toBe("COMPLETED");
  });
});

describe("receipts", () => {
  it("fetchReceipt: GET /api/v1/receipts/invoices/:invoiceId", async () => {
    const fetchMock = stubFetch({ receipt: { receiptNumber: "RCPT-ABCDEF12" } });
    const receipt = await fetchReceipt("i1");
    expect(call(fetchMock).url).toBe("/api/v1/receipts/invoices/i1");
    expect(receipt.receiptNumber).toBe("RCPT-ABCDEF12");
  });

  it("print opens the print URL as a new top-level tab and never fetches it", () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const open = vi.fn();
    openReceiptPrint("i1", open);
    expect(open).toHaveBeenCalledWith("/api/v1/receipts/invoices/i1/print", "_blank");
    expect(receiptPrintUrl("i1")).toBe("/api/v1/receipts/invoices/i1/print");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
