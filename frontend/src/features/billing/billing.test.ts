import { describe, expect, it } from "vitest";
import { ApiError } from "../../api";
import { ALL_ROLES } from "../../rbac/roles";
import { VISIT_STATUSES } from "../visits/types";
import { allowedBillingActions } from "./billingActions";
import { billingErrorMessage, writeFailureOutcome } from "./billingErrors";
import { EMPTY_ITEM_ROW, lineTotalCents, validateInvoiceItems, validatePayment, type ItemRow } from "./invoiceForms";
import { centsToAmount, isZeroBalance, parseMoneyToCents, toCents } from "./money";

describe("money", () => {
  it("parses typed amounts into exact cents", () => {
    expect(parseMoneyToCents("150")).toBe(15000);
    expect(parseMoneyToCents("150.5")).toBe(15050);
    expect(parseMoneyToCents(" 150.05 ")).toBe(15005);
    expect(parseMoneyToCents("0")).toBe(0);
  });

  it("refuses more than 2 decimals, signs, commas and text", () => {
    for (const bad of ["150.555", "-5", "1,000", "abc", "", ".5", "5."]) expect(parseMoneyToCents(bad), bad).toBeNull();
  });

  it("converts API amounts without floating-point dust", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(599.99)).toBe(59999);
    expect(centsToAmount(15050)).toBe(150.5);
    expect(isZeroBalance(0)).toBe(true);
    expect(isZeroBalance(0.001)).toBe(true);
    expect(isZeroBalance(0.01)).toBe(false);
  });
});

describe("allowedBillingActions", () => {
  const open = (balance: number) => ({ status: "OPEN" as const, balance });
  const paid = { status: "PAID" as const, balance: 0 };

  it("reception: create only when the visit is WAITING_FOR_BILLING and has no invoice", () => {
    expect(allowedBillingActions("reception", "WAITING_FOR_BILLING", null).canCreateInvoice).toBe(true);
    expect(allowedBillingActions("reception", "COMPLETED", null).canCreateInvoice).toBe(false);
  });

  it("reception, OPEN invoice with a balance: add charges and take payment, not complete", () => {
    expect(allowedBillingActions("reception", "WAITING_FOR_BILLING", open(150))).toEqual({
      canCreateInvoice: false,
      canAddItems: true,
      canRecordPayment: true,
      canComplete: false,
      canViewReceipt: false,
    });
  });

  it("reception, OPEN invoice with balance exactly 0 (including a zero-item invoice): complete, no payment", () => {
    const a = allowedBillingActions("reception", "WAITING_FOR_BILLING", open(0));
    expect(a.canComplete).toBe(true);
    expect(a.canRecordPayment).toBe(false);
    expect(a.canAddItems).toBe(true);
  });

  it("an OPEN invoice on a visit that is no longer WAITING_FOR_BILLING is read-only", () => {
    for (const status of VISIT_STATUSES.filter((s) => s !== "WAITING_FOR_BILLING")) {
      const a = allowedBillingActions("reception", status, open(150));
      expect(a.canAddItems || a.canRecordPayment || a.canComplete, status).toBe(false);
    }
  });

  it("PAID: only the receipt, for reception and owner", () => {
    for (const role of ["reception", "owner"]) {
      expect(allowedBillingActions(role, "COMPLETED", paid)).toEqual({
        canCreateInvoice: false,
        canAddItems: false,
        canRecordPayment: false,
        canComplete: false,
        canViewReceipt: true,
      });
    }
  });

  it("owner never gets a write; other roles get nothing at all", () => {
    for (const invoice of [null, open(10), open(0)]) {
      const a = allowedBillingActions("owner", "WAITING_FOR_BILLING", invoice);
      expect(Object.values(a).some(Boolean)).toBe(false);
    }
    for (const role of [...ALL_ROLES.filter((r) => r !== "reception" && r !== "owner"), "admin"]) {
      for (const invoice of [null, open(10), paid]) {
        expect(Object.values(allowedBillingActions(role, "WAITING_FOR_BILLING", invoice)).some(Boolean), role).toBe(false);
      }
    }
  });
});

describe("validateInvoiceItems (1–50; description 1–255, qty 1–100000, price 0–10,000,000)", () => {
  const row = (r: Partial<ItemRow>): ItemRow => ({ ...EMPTY_ITEM_ROW, ...r });

  it("builds items with exact prices and ignores untouched rows", () => {
    expect(
      validateInvoiceItems([row({ description: " Consultation ", unitPrice: "150" }), row({ description: "Lab", quantity: "2", unitPrice: "75.50" }), EMPTY_ITEM_ROW])
    ).toEqual({
      ok: true,
      items: [
        { description: "Consultation", quantity: 1, unitPrice: 150 },
        { description: "Lab", quantity: 2, unitPrice: 75.5 },
      ],
    });
  });

  it("allows a free (0) charge", () => {
    expect(validateInvoiceItems([row({ description: "Follow-up", unitPrice: "0" })]).ok).toBe(true);
  });

  it("requires a description, a whole quantity 1–100000 and a price with ≤2 decimals", () => {
    const result = validateInvoiceItems([row({ description: "", quantity: "0", unitPrice: "10.555" })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.rowErrors[0]!).sort()).toEqual(["description", "quantity", "unitPrice"]);
    expect(validateInvoiceItems([row({ description: "x", quantity: "100001", unitPrice: "1" })]).ok).toBe(false);
    expect(validateInvoiceItems([row({ description: "x", quantity: "2.5", unitPrice: "1" })]).ok).toBe(false);
  });

  it("enforces the price and description limits", () => {
    expect(validateInvoiceItems([row({ description: "d".repeat(255), unitPrice: "10000000" })]).ok).toBe(true);
    expect(validateInvoiceItems([row({ description: "d".repeat(256), unitPrice: "1" })]).ok).toBe(false);
    expect(validateInvoiceItems([row({ description: "x", unitPrice: "10000000.01" })]).ok).toBe(false);
  });

  it("needs at least one charge and at most 50", () => {
    const empty = validateInvoiceItems([EMPTY_ITEM_ROW]);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toBe("Add at least one charge.");
    const rows = (n: number) => Array.from({ length: n }, (_, i) => row({ description: `c${i}`, unitPrice: "1" }));
    expect(validateInvoiceItems(rows(50)).ok).toBe(true);
    expect(validateInvoiceItems(rows(51)).ok).toBe(false);
  });

  it("previews line totals in cents", () => {
    expect(lineTotalCents(row({ quantity: "3", unitPrice: "33.33" }))).toBe(9999);
    expect(lineTotalCents(row({ quantity: "x", unitPrice: "1" }))).toBeNull();
  });
});

describe("validatePayment", () => {
  it("accepts an exact final payment (no floating-point surprise)", () => {
    expect(validatePayment("599.99", "cash", 599.99)).toEqual({ ok: true, body: { amount: 599.99, method: "cash" } });
    expect(validatePayment("0.3", "other", 0.1 + 0.2).ok).toBe(true);
  });

  it("refuses a payment above the current balance before sending (OVERPAYMENT)", () => {
    const result = validatePayment("150.01", "cash", 150);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.amount).toBe("That is more than the remaining balance.");
  });

  it("refuses zero, blank, more than 2 decimals and text", () => {
    for (const bad of ["0", "", "10.555", "ten", "-5"]) expect(validatePayment(bad, "cash", 100).ok, bad).toBe(false);
  });

  it("requires one of cash, bank_transfer, other", () => {
    const result = validatePayment("10", "", 100);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.method).toBeDefined();
    expect(validatePayment("10", "bank_transfer", 100).ok).toBe(true);
  });
});

describe("billing errors", () => {
  it("maps each billing and receipt code", () => {
    expect(billingErrorMessage(new ApiError(409, "INVOICE_ALREADY_EXISTS", "x"))).toMatch(/already has an invoice/);
    expect(billingErrorMessage(new ApiError(409, "INVOICE_NOT_OPEN", "Invoice is already PAID"))).toMatch(/already paid/);
    expect(billingErrorMessage(new ApiError(400, "OVERPAYMENT", "x"))).toMatch(/more than the remaining balance/);
    expect(billingErrorMessage(new ApiError(409, "INVOICE_NOT_PAID", "x"))).toMatch(/still has a balance/);
    expect(billingErrorMessage(new ApiError(409, "RECEIPT_NOT_AVAILABLE_UNTIL_PAID", "x"))).toMatch(/fully paid/);
    expect(
      billingErrorMessage(
        new ApiError(409, "INVALID_VISIT_STATE", "Billing can only be completed while the visit is WAITING_FOR_BILLING (currently CANCELLED)")
      )
    ).toMatch(/cancelled/);
  });

  it("tells a refused write from one that may have been saved", () => {
    expect(writeFailureOutcome(new ApiError(400, "OVERPAYMENT", "x"))).toBe("not-saved");
    expect(writeFailureOutcome(new ApiError(500, "INTERNAL_ERROR", "x"))).toBe("unknown");
    expect(writeFailureOutcome(new ApiError(0, "NETWORK_ERROR", "x"))).toBe("unknown");
  });
});
