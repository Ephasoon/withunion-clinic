import { describe, expect, it } from "vitest";
import { ALL_ROLES } from "../../rbac/roles";
import type { LabOrderDetail } from "../doctor/types";
import { VISIT_STATUSES } from "../visits/types";
import { allowedLabActions, groupOrdersByVisit } from "./labActions";
import { currentStatusFromMessage, labErrorMessage } from "./labErrors";
import { missingResults, ordersInRound, parseIncompleteResults } from "./missingResults";
import { hasUnsavedResults, resultsFormFrom, validateResultsForm } from "./resultsForm";
import { ApiError } from "../../api";

const ORDER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORDER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function order(
  id: string,
  opts: { visitId?: string; status?: "REQUESTED" | "COMPLETED"; tests: Array<[string, string | null]> }
): LabOrderDetail {
  return {
    id,
    visitId: opts.visitId ?? "v1",
    consultationId: "c1",
    requestedBy: "d1",
    requestedByName: "Dr A",
    status: opts.status ?? "REQUESTED",
    requestedAt: "2026-09-28T08:00:00.000Z",
    visitStatus: "AT_LAB",
    patientCode: "WU-000001",
    patientFullName: "A",
    items: opts.tests.map(([testName, result], i) => ({
      id: `${id}-item-${i}`,
      testName,
      result,
      resultEnteredBy: null,
      resultEnteredAt: null,
    })),
  };
}

describe("allowedLabActions", () => {
  it("lab tech: start only from WAITING_FOR_LAB", () => {
    expect(allowedLabActions("lab_tech", "WAITING_FOR_LAB", "REQUESTED")).toEqual({
      canStart: true,
      canEnterResults: false,
      canComplete: false,
    });
  });

  it("lab tech: results and complete only while AT_LAB", () => {
    expect(allowedLabActions("lab_tech", "AT_LAB", "REQUESTED")).toEqual({
      canStart: false,
      canEnterResults: true,
      canComplete: true,
    });
  });

  it("lab tech: nothing on a COMPLETED order, whatever the visit status", () => {
    for (const status of VISIT_STATUSES) {
      expect(allowedLabActions("lab_tech", status, "COMPLETED")).toEqual({
        canStart: false,
        canEnterResults: false,
        canComplete: false,
      });
    }
  });

  it("lab tech: nothing in any other visit status (LAB_COMPLETED, CANCELLED, …)", () => {
    for (const status of VISIT_STATUSES.filter((s) => s !== "WAITING_FOR_LAB" && s !== "AT_LAB")) {
      const a = allowedLabActions("lab_tech", status, "REQUESTED");
      expect(a.canStart || a.canEnterResults || a.canComplete, status).toBe(false);
    }
  });

  it("owner and every other role view only", () => {
    for (const role of [...ALL_ROLES.filter((r) => r !== "lab_tech"), "admin", ""]) {
      for (const status of VISIT_STATUSES) {
        const a = allowedLabActions(role, status, "REQUESTED");
        expect(a.canStart || a.canEnterResults || a.canComplete, `${role} ${status}`).toBe(false);
      }
    }
  });
});

describe("groupOrdersByVisit", () => {
  it("groups a visit's orders together and keeps the API order", () => {
    const groups = groupOrdersByVisit([
      order("o1", { visitId: "v1", tests: [["CBC", null]] }),
      order("o2", { visitId: "v2", tests: [["RDT", null]] }),
      order("o3", { visitId: "v1", tests: [["Urinalysis", null]] }),
    ]);
    expect(groups.map((g) => [g.visitId, g.orders.map((o) => o.id)])).toEqual([
      ["v1", ["o1", "o3"]],
      ["v2", ["o2"]],
    ]);
  });

  it("returns nothing for an empty queue", () => {
    expect(groupOrdersByVisit([])).toEqual([]);
  });
});

describe("results form", () => {
  const items = order(ORDER_A, {
    tests: [
      ["CBC", "Normal"],
      ["Malaria RDT", null],
      ["Urinalysis", null],
    ],
  }).items;

  it("starts from the saved results", () => {
    expect(resultsFormFrom(items)).toEqual({ [items[0]!.id]: "Normal", [items[1]!.id]: "", [items[2]!.id]: "" });
  });

  it("sends only new or changed results, trimmed", () => {
    const values = { [items[0]!.id]: " Low Hb ", [items[1]!.id]: "Positive", [items[2]!.id]: "" };
    expect(validateResultsForm(items, values)).toEqual({
      ok: true,
      results: [
        { itemId: items[0]!.id, result: "Low Hb" },
        { itemId: items[1]!.id, result: "Positive" },
      ],
    });
  });

  it("skips blank fields without a saved result, and unchanged saved ones", () => {
    const values = { ...resultsFormFrom(items), [items[2]!.id]: "Clear" };
    expect(validateResultsForm(items, values)).toEqual({ ok: true, results: [{ itemId: items[2]!.id, result: "Clear" }] });
  });

  it("refuses to clear a saved result", () => {
    const result = validateResultsForm(items, { ...resultsFormFrom(items), [items[0]!.id]: "  " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[items[0]!.id]).toMatch(/can’t be cleared/);
  });

  it("enforces 2000 characters after trimming", () => {
    expect(validateResultsForm(items, { [items[1]!.id]: ` ${"r".repeat(2000)} ` }).ok).toBe(true);
    expect(validateResultsForm(items, { [items[1]!.id]: "r".repeat(2001) }).ok).toBe(false);
  });

  it("needs at least one change", () => {
    const result = validateResultsForm(items, resultsFormFrom(items));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least one result/);
  });

  it("detects unsaved edits", () => {
    expect(hasUnsavedResults(items, resultsFormFrom(items))).toBe(false);
    expect(hasUnsavedResults(items, { ...resultsFormFrom(items), [items[1]!.id]: "x" })).toBe(true);
    expect(hasUnsavedResults(items, { ...resultsFormFrom(items), [items[0]!.id]: " Normal " })).toBe(false);
  });
});

describe("missingResults", () => {
  it("lists tests without a result across every REQUESTED order on the visit", () => {
    const visitOrders = [
      order(ORDER_A, { tests: [["CBC", "Normal"], ["Malaria RDT", null]] }),
      order(ORDER_B, { tests: [["Urinalysis", "   "]] }),
    ];
    expect(missingResults(visitOrders).map((m) => [m.orderId, m.testNames])).toEqual([
      [ORDER_A, ["Malaria RDT"]],
      [ORDER_B, ["Urinalysis"]],
    ]);
  });

  it("ignores COMPLETED orders from an earlier round", () => {
    const visitOrders = [
      order("old", { status: "COMPLETED", tests: [["Old test", null]] }),
      order(ORDER_A, { tests: [["CBC", "Normal"]] }),
    ];
    expect(missingResults(visitOrders)).toEqual([]);
    expect(ordersInRound(visitOrders).map((o) => o.id)).toEqual([ORDER_A]);
  });
});

describe("parseIncompleteResults", () => {
  it("parses this order's tests and other orders' suffixed tests", () => {
    const message = `Cannot complete: missing results for Malaria RDT, Urinalysis (order ${ORDER_B})`;
    expect(parseIncompleteResults(message, ORDER_A)).toEqual([
      { testName: "Malaria RDT", orderId: ORDER_A },
      { testName: "Urinalysis", orderId: ORDER_B },
    ]);
  });

  it("returns null for an unexpected format, so the raw message is shown", () => {
    expect(parseIncompleteResults("Something else entirely", ORDER_A)).toBeNull();
    expect(parseIncompleteResults("Cannot complete: missing results for ", ORDER_A)).toBeNull();
    expect(parseIncompleteResults("Cannot complete: missing results for A, , B", ORDER_A)).toBeNull();
  });

  it("rejects a parse that does not match the loaded tests (e.g. a test name containing ', ')", () => {
    const known = [{ orderId: ORDER_A, testName: "Electrolytes, serum" }];
    const message = "Cannot complete: missing results for Electrolytes, serum";
    expect(parseIncompleteResults(message, ORDER_A, known)).toBeNull();
  });

  it("accepts a parse whose tests all match the loaded tests", () => {
    const known = [
      { orderId: ORDER_A, testName: "Malaria RDT" },
      { orderId: ORDER_B, testName: "Urinalysis" },
    ];
    const message = `Cannot complete: missing results for Malaria RDT, Urinalysis (order ${ORDER_B})`;
    expect(parseIncompleteResults(message, ORDER_A, known)).toHaveLength(2);
  });
});

describe("labErrorMessage", () => {
  it("maps the lab error codes to friendly text", () => {
    expect(labErrorMessage(new ApiError(409, "LAB_ORDER_NOT_REQUESTED", "Laboratory order is already COMPLETED"))).toBe(
      "This order was already completed."
    );
    expect(labErrorMessage(new ApiError(409, "VISIT_TERMINAL", "x"))).toMatch(/completed or cancelled/);
    expect(labErrorMessage(new ApiError(400, "ITEM_NOT_IN_ORDER", "x"))).toMatch(/does not belong to this order/);
    expect(labErrorMessage(new ApiError(404, "NOT_FOUND", "Laboratory order not found"))).toBe(
      "This lab order does not exist."
    );
  });

  it("names the visit's current status for INVALID_VISIT_STATE when the message says it", () => {
    const error = new ApiError(
      409,
      "INVALID_VISIT_STATE",
      "Results can only be entered while the visit is AT_LAB (currently LAB_COMPLETED)"
    );
    expect(currentStatusFromMessage(error.message)).toBe("LAB_COMPLETED");
    expect(labErrorMessage(error)).toMatch(/lab completed/);
    expect(labErrorMessage(new ApiError(409, "INVALID_VISIT_STATE", "odd"))).toMatch(/not at the right lab step/);
  });
});
