import { describe, expect, it } from "vitest";
import { ALL_ROLES } from "../../rbac/roles";
import { VISIT_STATUSES, type Visit, type VisitStatus } from "./types";
import { allowedVisitActions, findOpenVisits, isTerminalStatus, validateCancelReason } from "./visitActions";

const targets = (role: string, status: VisitStatus) => allowedVisitActions(role, status).map((a) => a.toStatus);

describe("allowedVisitActions — reception", () => {
  it("offers send to nurse, send to doctor and cancel from REGISTERED", () => {
    expect(targets("reception", "REGISTERED")).toEqual(["WAITING_FOR_NURSE", "WAITING_FOR_DOCTOR", "CANCELLED"]);
  });

  it("offers only cancel from every other non-terminal status", () => {
    const others = VISIT_STATUSES.filter((s) => s !== "REGISTERED" && s !== "COMPLETED" && s !== "CANCELLED");
    expect(others).toHaveLength(10);
    for (const status of others) expect(targets("reception", status)).toEqual(["CANCELLED"]);
  });

  it("offers nothing — not even COMPLETED — from WAITING_FOR_BILLING except cancel", () => {
    expect(targets("reception", "WAITING_FOR_BILLING")).toEqual(["CANCELLED"]);
  });

  it("offers nothing on a terminal visit", () => {
    expect(targets("reception", "COMPLETED")).toEqual([]);
    expect(targets("reception", "CANCELLED")).toEqual([]);
  });
});

describe("allowedVisitActions — owner and other roles", () => {
  it("owner may only cancel, from any non-terminal status", () => {
    for (const status of VISIT_STATUSES) {
      expect(targets("owner", status)).toEqual(isTerminalStatus(status) ? [] : ["CANCELLED"]);
    }
  });

  it("nurse, doctor, lab tech, pharmacy and unknown roles get no actions on this screen", () => {
    for (const role of ["nurse", "doctor", "lab_tech", "pharmacy", "admin", ""]) {
      for (const status of VISIT_STATUSES) expect(targets(role, status)).toEqual([]);
    }
  });
});

describe("allowedVisitActions — never offers a module-owned or foreign transition", () => {
  it("only ever targets WAITING_FOR_NURSE, WAITING_FOR_DOCTOR or CANCELLED, for every role and status", () => {
    const permitted = new Set(["WAITING_FOR_NURSE", "WAITING_FOR_DOCTOR", "CANCELLED"]);
    for (const role of ALL_ROLES) {
      for (const status of VISIT_STATUSES) {
        for (const target of targets(role, status)) expect(permitted.has(target)).toBe(true);
      }
    }
  });

  it("never targets WAITING_FOR_LAB, LAB_COMPLETED, WAITING_FOR_PHARMACY, WAITING_FOR_BILLING or COMPLETED", () => {
    const blocked = ["WAITING_FOR_LAB", "LAB_COMPLETED", "WAITING_FOR_PHARMACY", "WAITING_FOR_BILLING", "COMPLETED"];
    for (const role of ALL_ROLES) {
      for (const status of VISIT_STATUSES) {
        for (const target of targets(role, status)) expect(blocked).not.toContain(target);
      }
    }
  });

  it("only sends to nurse or doctor from REGISTERED", () => {
    for (const role of ALL_ROLES) {
      for (const status of VISIT_STATUSES) {
        const sends = allowedVisitActions(role, status).filter((a) => a.kind === "send");
        if (sends.length > 0) expect(status).toBe("REGISTERED");
      }
    }
  });
});

describe("findOpenVisits", () => {
  const visit = (id: string, status: VisitStatus): Visit => ({
    id,
    patientId: "p1",
    patientCode: "WU-000001",
    patientFullName: "A",
    status,
    createdBy: "u1",
    createdAt: "2026-09-28T08:00:00.000Z",
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
  });

  it("returns only non-terminal visits", () => {
    const visits = [visit("a", "COMPLETED"), visit("b", "WITH_DOCTOR"), visit("c", "CANCELLED"), visit("d", "REGISTERED")];
    expect(findOpenVisits(visits).map((v) => v.id)).toEqual(["b", "d"]);
  });

  it("returns nothing for an empty or fully closed history", () => {
    expect(findOpenVisits([])).toEqual([]);
    expect(findOpenVisits([visit("a", "COMPLETED"), visit("b", "CANCELLED")])).toEqual([]);
  });
});

describe("validateCancelReason", () => {
  it("requires a non-blank reason", () => {
    expect(validateCancelReason("")).toMatchObject({ ok: false });
    expect(validateCancelReason("   \n ")).toMatchObject({ ok: false });
  });

  it("trims the reason it returns", () => {
    expect(validateCancelReason("  Patient left  ")).toEqual({ ok: true, reason: "Patient left" });
  });

  it("allows up to 2000 characters after trimming and rejects more", () => {
    expect(validateCancelReason("x".repeat(2000))).toMatchObject({ ok: true });
    expect(validateCancelReason(` ${"x".repeat(2000)} `)).toMatchObject({ ok: true });
    expect(validateCancelReason("x".repeat(2001))).toMatchObject({ ok: false });
  });
});
