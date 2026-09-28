import { describe, expect, it } from "vitest";
import { ALL_ROLES } from "../../rbac/roles";
import { VISIT_STATUSES, type Visit, type VisitStatus } from "../visits/types";
import { allowedDoctorVisitActions, canEditConsultation, findOpenConsultation, splitDoctorQueue } from "./doctorActions";

const on = (status: VisitStatus, hasOpen = false) => allowedDoctorVisitActions("doctor", status, hasOpen);
const none = { canStartConsultation: false, canTakeBackForReview: false, canOpenReviewConsultation: false };

describe("allowedDoctorVisitActions — doctor", () => {
  it("starts a consultation from WAITING_FOR_DOCTOR", () => {
    expect(on("WAITING_FOR_DOCTOR")).toEqual({ ...none, canStartConsultation: true });
  });

  it("takes the visit back for review from LAB_COMPLETED", () => {
    expect(on("LAB_COMPLETED")).toEqual({ ...none, canTakeBackForReview: true });
  });

  it("opens a review consultation while WITH_DOCTOR with none open", () => {
    expect(on("WITH_DOCTOR")).toEqual({ ...none, canOpenReviewConsultation: true });
  });

  it("offers no new consultation while one is already open", () => {
    expect(on("WAITING_FOR_DOCTOR", true)).toEqual(none);
    expect(on("WITH_DOCTOR", true)).toEqual(none);
  });

  it("has no actions in any other status", () => {
    const others = VISIT_STATUSES.filter((s) => !["WAITING_FOR_DOCTOR", "WITH_DOCTOR", "LAB_COMPLETED"].includes(s));
    expect(others).toHaveLength(10);
    for (const status of others) expect(on(status)).toEqual(none);
  });
});

describe("allowedDoctorVisitActions — other roles view only", () => {
  it("owner, reception, nurse, lab tech, pharmacy and unknown roles never get an action", () => {
    for (const role of [...ALL_ROLES.filter((r) => r !== "doctor"), "admin", ""]) {
      for (const status of VISIT_STATUSES) {
        expect(allowedDoctorVisitActions(role, status, false), `${role} ${status}`).toEqual(none);
      }
    }
  });
});

describe("canEditConsultation", () => {
  const doctor = { id: "d1", role: "doctor" };

  it("allows only the consultation's own doctor while it is open", () => {
    expect(canEditConsultation(doctor, { doctorId: "d1", completedAt: null })).toBe(true);
  });

  it("refuses another doctor, a completed consultation, the owner and no user", () => {
    expect(canEditConsultation(doctor, { doctorId: "d2", completedAt: null })).toBe(false);
    expect(canEditConsultation(doctor, { doctorId: "d1", completedAt: "2026-09-28T10:00:00.000Z" })).toBe(false);
    expect(canEditConsultation({ id: "d1", role: "owner" }, { doctorId: "d1", completedAt: null })).toBe(false);
    expect(canEditConsultation(null, { doctorId: "d1", completedAt: null })).toBe(false);
  });
});

describe("findOpenConsultation", () => {
  it("returns the consultation without completedAt, or null", () => {
    const done = { id: "a", completedAt: "2026-09-28T09:00:00.000Z" };
    const open = { id: "b", completedAt: null };
    expect(findOpenConsultation([done, open])).toBe(open);
    expect(findOpenConsultation([done])).toBeNull();
    expect(findOpenConsultation([])).toBeNull();
  });
});

describe("splitDoctorQueue", () => {
  const visit = (id: string, status: VisitStatus): Visit => ({
    id,
    patientId: "p",
    patientCode: "WU-000001",
    patientFullName: "A",
    status,
    createdBy: "u",
    createdAt: "2026-09-28T08:00:00.000Z",
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
  });

  it("splits by step, keeps order, and drops every other status (the owner's list has all of them)", () => {
    const result = splitDoctorQueue([
      visit("a", "WAITING_FOR_DOCTOR"),
      visit("b", "LAB_COMPLETED"),
      visit("c", "WITH_NURSE"),
      visit("d", "WITH_DOCTOR"),
      visit("e", "WAITING_FOR_DOCTOR"),
    ]);
    expect(result.withDoctor.map((v) => v.id)).toEqual(["d"]);
    expect(result.labCompleted.map((v) => v.id)).toEqual(["b"]);
    expect(result.waiting.map((v) => v.id)).toEqual(["a", "e"]);
  });
});
