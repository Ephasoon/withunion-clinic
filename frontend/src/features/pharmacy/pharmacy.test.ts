import { describe, expect, it } from "vitest";
import { ApiError } from "../../api";
import { ALL_ROLES } from "../../rbac/roles";
import type { PrescriptionDetail, PrescriptionItemStatus } from "../doctor/types";
import type { InventoryItem } from "../inventory/types";
import { VISIT_STATUSES } from "../visits/types";
import {
  canDispenseItem,
  canMarkUnavailable,
  maxDispensable,
  remainingQuantity,
  validateDispenseForm,
  type DispenseRow,
} from "./dispenseForm";
import { parseIncompleteDispensing, pendingItems } from "./pendingItems";
import { allowedPharmacyActions, groupPrescriptionsByVisit } from "./pharmacyActions";
import { dispenseFailureOutcome, medicineFromMessage, pharmacyErrorMessage } from "./pharmacyErrors";

const RX_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RX_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ITEM_1 = "11111111-1111-4111-8111-111111111111";

type ItemSpec = { id?: string; name: string; status?: PrescriptionItemStatus; prescribed?: number | null; dispensed?: number | null };

function prescription(id: string, items: ItemSpec[], visitId = "v1"): PrescriptionDetail {
  return {
    id,
    visitId,
    consultationId: "c1",
    doctorId: "d1",
    doctorName: "Dr A",
    visitStatus: "AT_PHARMACY",
    patientCode: "WU-000001",
    patientFullName: "A",
    createdAt: "2026-09-28T08:00:00.000Z",
    items: items.map((s, i) => ({
      id: s.id ?? `${id}-item-${i}`,
      medicineName: s.name,
      strength: null,
      dosage: null,
      frequency: null,
      duration: null,
      quantityPrescribed: s.prescribed === undefined ? 10 : s.prescribed,
      quantityDispensed: s.dispensed ?? null,
      status: s.status ?? "PENDING",
      inventoryItemId: null,
      dispensedBy: null,
      dispensedAt: null,
    })),
  };
}

const stock = (id: string, quantityOnHand: number): InventoryItem => ({ id, name: `Stock ${id}`, unit: "tab", quantityOnHand });

describe("allowedPharmacyActions", () => {
  it("pharmacy: start only from WAITING_FOR_PHARMACY", () => {
    expect(allowedPharmacyActions("pharmacy", "WAITING_FOR_PHARMACY")).toEqual({
      canStart: true,
      canDispense: false,
      canComplete: false,
    });
  });

  it("pharmacy: dispense and complete only while AT_PHARMACY", () => {
    expect(allowedPharmacyActions("pharmacy", "AT_PHARMACY")).toEqual({
      canStart: false,
      canDispense: true,
      canComplete: true,
    });
  });

  it("pharmacy: nothing in any other status", () => {
    for (const s of VISIT_STATUSES.filter((s) => s !== "WAITING_FOR_PHARMACY" && s !== "AT_PHARMACY")) {
      const a = allowedPharmacyActions("pharmacy", s);
      expect(a.canStart || a.canDispense || a.canComplete, s).toBe(false);
    }
  });

  it("owner and every other role view only", () => {
    for (const role of [...ALL_ROLES.filter((r) => r !== "pharmacy"), "admin", ""]) {
      for (const s of VISIT_STATUSES) {
        const a = allowedPharmacyActions(role, s);
        expect(a.canStart || a.canDispense || a.canComplete, `${role} ${s}`).toBe(false);
      }
    }
  });
});

describe("groupPrescriptionsByVisit", () => {
  it("groups a visit's prescriptions and keeps order", () => {
    const groups = groupPrescriptionsByVisit([
      prescription("p1", [{ name: "A" }], "v1"),
      prescription("p2", [{ name: "B" }], "v2"),
      prescription("p3", [{ name: "C" }], "v1"),
    ]);
    expect(groups.map((g) => [g.visitId, g.prescriptions.map((p) => p.id)])).toEqual([
      ["v1", ["p1", "p3"]],
      ["v2", ["p2"]],
    ]);
  });
});

describe("item rules", () => {
  it("remaining = prescribed − dispensed, or null when no quantity was prescribed", () => {
    expect(remainingQuantity({ quantityPrescribed: 10, quantityDispensed: null })).toBe(10);
    expect(remainingQuantity({ quantityPrescribed: 10, quantityDispensed: 4 })).toBe(6);
    expect(remainingQuantity({ quantityPrescribed: null, quantityDispensed: null })).toBeNull();
  });

  it("dispense allowed on PENDING and PARTIALLY_DISPENSED; unavailable only on PENDING", () => {
    expect(canDispenseItem({ status: "PENDING" })).toBe(true);
    expect(canDispenseItem({ status: "PARTIALLY_DISPENSED" })).toBe(true);
    expect(canDispenseItem({ status: "DISPENSED" })).toBe(false);
    expect(canDispenseItem({ status: "UNAVAILABLE" })).toBe(false);
    expect(canMarkUnavailable({ status: "PENDING" })).toBe(true);
    expect(canMarkUnavailable({ status: "PARTIALLY_DISPENSED" })).toBe(false);
  });

  it("maxDispensable never exceeds remaining, stock or 1,000,000", () => {
    expect(maxDispensable({ quantityPrescribed: 10, quantityDispensed: 4 }, stock("s", 100))).toBe(6);
    expect(maxDispensable({ quantityPrescribed: 10, quantityDispensed: 0 }, stock("s", 3))).toBe(3);
    expect(maxDispensable({ quantityPrescribed: null, quantityDispensed: null }, stock("s", 5_000_000))).toBe(1_000_000);
    expect(maxDispensable({ quantityPrescribed: 10, quantityDispensed: 0 }, undefined)).toBe(0);
  });
});

describe("validateDispenseForm — exactly one of dispense or mark-unavailable per entry", () => {
  const rx = prescription(RX_A, [
    { id: "i1", name: "Amoxicillin", prescribed: 15, dispensed: 5, status: "PARTIALLY_DISPENSED" },
    { id: "i2", name: "Paracetamol", prescribed: null },
    { id: "i3", name: "ORS", prescribed: 4 },
    { id: "i4", name: "Done", status: "DISPENSED" },
  ]);
  const inventory = [stock("s1", 50), stock("s2", 3)];
  const row = (r: Partial<DispenseRow>): DispenseRow => ({ action: "skip", inventoryItemId: "", quantity: "", ...r });

  it("builds a dispense entry and a mark-unavailable entry, never mixing their fields", () => {
    const result = validateDispenseForm(
      rx.items,
      { i1: row({ action: "dispense", inventoryItemId: "s1", quantity: "10" }), i3: row({ action: "unavailable", inventoryItemId: "s1", quantity: "2" }) },
      inventory
    );
    expect(result).toEqual({
      ok: true,
      entries: [
        { itemId: "i1", inventoryItemId: "s1", quantity: 10 },
        { itemId: "i3", markUnavailable: true },
      ],
    });
  });

  it("leaves out skipped rows and needs at least one entry", () => {
    const result = validateDispenseForm(rx.items, { i1: row({}) }, inventory);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least one/);
  });

  it("requires an explicitly chosen stock item", () => {
    const result = validateDispenseForm(rx.items, { i3: row({ action: "dispense", quantity: "1" }) }, inventory);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rowErrors.i3?.inventoryItemId).toMatch(/Choose the stock item/);
  });

  it("refuses a stock item that is not in the list", () => {
    const result = validateDispenseForm(rx.items, { i3: row({ action: "dispense", inventoryItemId: "gone", quantity: "1" }) }, inventory);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rowErrors.i3?.inventoryItemId).toMatch(/no longer exists/);
  });

  it("refuses a quantity above what remains (EXCEEDS_PRESCRIBED_QUANTITY)", () => {
    const result = validateDispenseForm(rx.items, { i1: row({ action: "dispense", inventoryItemId: "s1", quantity: "11" }) }, inventory);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rowErrors.i1?.quantity).toBe("Only 10 left to dispense.");
  });

  it("refuses a quantity above stock on hand (INSUFFICIENT_STOCK)", () => {
    const result = validateDispenseForm(rx.items, { i3: row({ action: "dispense", inventoryItemId: "s2", quantity: "4" }) }, inventory);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rowErrors.i3?.quantity).toMatch(/Only 3 tab in stock/);
  });

  it("adds up rows drawing on the same stock item", () => {
    const result = validateDispenseForm(
      rx.items,
      {
        i2: row({ action: "dispense", inventoryItemId: "s2", quantity: "2" }),
        i3: row({ action: "dispense", inventoryItemId: "s2", quantity: "2" }),
      },
      inventory
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rowErrors.i3?.quantity).toMatch(/across this batch/);
  });

  it("allows any quantity (up to stock) when no quantity was prescribed", () => {
    expect(validateDispenseForm(rx.items, { i2: row({ action: "dispense", inventoryItemId: "s1", quantity: "40" }) }, inventory).ok).toBe(true);
  });

  it("refuses zero, decimals and text", () => {
    for (const bad of ["0", "2.5", "abc", ""]) {
      const result = validateDispenseForm(rx.items, { i3: row({ action: "dispense", inventoryItemId: "s1", quantity: bad }) }, inventory);
      expect(result.ok, bad).toBe(false);
    }
  });

  it("refuses dispensing a DISPENSED item and marking a partly dispensed one unavailable (ITEM_ALREADY_TERMINAL)", () => {
    const result = validateDispenseForm(
      rx.items,
      { i4: row({ action: "dispense", inventoryItemId: "s1", quantity: "1" }), i1: row({ action: "unavailable" }) },
      inventory
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rowErrors.i4?.action).toBeDefined();
      expect(result.rowErrors.i1?.action).toMatch(/not yet dispensed/);
    }
  });
});

describe("pendingItems", () => {
  it("lists only PENDING items, across every prescription on the visit", () => {
    const pending = pendingItems([
      prescription(RX_A, [{ name: "Amoxicillin", status: "PENDING" }, { name: "Paracetamol", status: "PARTIALLY_DISPENSED" }]),
      prescription(RX_B, [{ name: "ORS", status: "UNAVAILABLE" }, { name: "Zinc", status: "PENDING" }]),
      prescription("done", [{ name: "Iron", status: "DISPENSED" }]),
    ]);
    expect(pending.map((p) => [p.prescriptionId, p.medicineNames])).toEqual([
      [RX_A, ["Amoxicillin"]],
      [RX_B, ["Zinc"]],
    ]);
  });
});

describe("parseIncompleteDispensing", () => {
  it("parses this prescription's medicines and other prescriptions' suffixed ones", () => {
    expect(parseIncompleteDispensing(`Cannot complete: still pending for Amoxicillin, Zinc (prescription ${RX_B})`, RX_A)).toEqual([
      { medicineName: "Amoxicillin", prescriptionId: RX_A },
      { medicineName: "Zinc", prescriptionId: RX_B },
    ]);
  });

  it("returns null for an unexpected format", () => {
    expect(parseIncompleteDispensing("Something else", RX_A)).toBeNull();
    expect(parseIncompleteDispensing("Cannot complete: still pending for ", RX_A)).toBeNull();
    expect(parseIncompleteDispensing("Cannot complete: still pending for A, , B", RX_A)).toBeNull();
  });

  it("rejects a parse that does not match the loaded pending medicines (e.g. a name containing ', ')", () => {
    const known = [{ prescriptionId: RX_A, medicineName: "Vitamin B, complex" }];
    expect(parseIncompleteDispensing("Cannot complete: still pending for Vitamin B, complex", RX_A, known)).toBeNull();
  });
});

describe("pharmacy error messages", () => {
  const items = [{ id: ITEM_1, medicineName: "Amoxicillin" }];

  it("INSUFFICIENT_STOCK covers the missing-stock-item quirk, and names the medicine", () => {
    expect(
      pharmacyErrorMessage(new ApiError(409, "INSUFFICIENT_STOCK", `Insufficient stock to dispense 5 of item ${ITEM_1}`), items)
    ).toBe("Not enough stock, or that stock item no longer exists (Amoxicillin).");
  });

  it("maps the other dispense and state codes", () => {
    expect(pharmacyErrorMessage(new ApiError(400, "EXCEEDS_PRESCRIBED_QUANTITY", `… for item ${ITEM_1}`), items)).toMatch(
      /more than is left to dispense \(Amoxicillin\)/
    );
    expect(pharmacyErrorMessage(new ApiError(409, "ITEM_ALREADY_TERMINAL", `Item ${ITEM_1} is already DISPENSED`), items)).toMatch(
      /already been fully dispensed/
    );
    expect(pharmacyErrorMessage(new ApiError(400, "ITEM_NOT_IN_PRESCRIPTION", "x"))).toMatch(/does not belong/);
    expect(pharmacyErrorMessage(new ApiError(409, "VISIT_TERMINAL", "x"))).toMatch(/completed or cancelled/);
    expect(
      pharmacyErrorMessage(
        new ApiError(409, "INVALID_VISIT_STATE", "Dispensing can only happen while the visit is AT_PHARMACY (currently WAITING_FOR_BILLING)")
      )
    ).toMatch(/waiting for billing/);
  });

  it("finds the medicine for an item id, or null", () => {
    expect(medicineFromMessage(`Item ${ITEM_1} is already UNAVAILABLE`, items)).toBe("Amoxicillin");
    expect(medicineFromMessage("no id here", items)).toBeNull();
  });

  it("says nothing was dispensed only when the whole batch was certainly rolled back (4xx)", () => {
    expect(dispenseFailureOutcome(new ApiError(409, "INSUFFICIENT_STOCK", "x"))).toBe("rolled-back");
    expect(dispenseFailureOutcome(new ApiError(400, "VALIDATION_ERROR", "x"))).toBe("rolled-back");
    expect(dispenseFailureOutcome(new ApiError(500, "INTERNAL_ERROR", "x"))).toBe("unknown");
    expect(dispenseFailureOutcome(new ApiError(0, "NETWORK_ERROR", "x"))).toBe("unknown");
  });
});
