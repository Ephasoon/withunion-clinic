import { describe, expect, it } from "vitest";
import { ALL_ROLES } from "../../rbac/roles";
import { VISIT_STATUSES, type Visit, type VisitStatus } from "../visits/types";
import { allowedNurseActions, assessmentFailureFollowUp, splitNurseQueue } from "./nurseActions";

describe("allowedNurseActions — nurse", () => {
  it("may only pick up from WAITING_FOR_NURSE", () => {
    expect(allowedNurseActions("nurse", "WAITING_FOR_NURSE")).toEqual({
      canPickUp: true,
      canRecordVitals: false,
      canRecordAssessment: false,
    });
  });

  it("may record vitals and the assessment only while WITH_NURSE", () => {
    expect(allowedNurseActions("nurse", "WITH_NURSE")).toEqual({
      canPickUp: false,
      canRecordVitals: true,
      canRecordAssessment: true,
    });
  });

  it("has no actions in any other status, including terminal ones", () => {
    const others = VISIT_STATUSES.filter((s) => s !== "WAITING_FOR_NURSE" && s !== "WITH_NURSE");
    expect(others).toHaveLength(11);
    for (const status of others) {
      expect(allowedNurseActions("nurse", status)).toEqual({
        canPickUp: false,
        canRecordVitals: false,
        canRecordAssessment: false,
      });
    }
  });
});

describe("allowedNurseActions — every other role views only", () => {
  it("owner, reception, doctor, lab tech, pharmacy and unknown roles never get an action", () => {
    const viewers = [...ALL_ROLES.filter((r) => r !== "nurse"), "admin", ""];
    for (const role of viewers) {
      for (const status of VISIT_STATUSES) {
        const actions = allowedNurseActions(role, status);
        expect(actions.canPickUp || actions.canRecordVitals || actions.canRecordAssessment, `${role} ${status}`).toBe(
          false
        );
      }
    }
  });
});

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

describe("splitNurseQueue", () => {
  it("splits by step, keeps order, and drops every other status (the owner's list has all of them)", () => {
    const visits = [
      visit("a", "WAITING_FOR_NURSE"),
      visit("b", "WITH_DOCTOR"),
      visit("c", "WITH_NURSE"),
      visit("d", "WAITING_FOR_NURSE"),
      visit("e", "CANCELLED"),
    ];
    const { waiting, withNurse } = splitNurseQueue(visits);
    expect(waiting.map((v) => v.id)).toEqual(["a", "d"]);
    expect(withNurse.map((v) => v.id)).toEqual(["c"]);
  });

  it("handles an empty queue", () => {
    expect(splitNurseQueue([])).toEqual({ waiting: [], withNurse: [] });
  });
});

describe("assessmentFailureFollowUp", () => {
  it("explains a saved assessment whose hand-off failed (visit still WITH_NURSE)", () => {
    expect(assessmentFailureFollowUp("WITH_NURSE", true)).toMatch(/saved, but the visit was not sent/);
  });

  it("adds nothing when nothing was saved and the visit is still WITH_NURSE", () => {
    expect(assessmentFailureFollowUp("WITH_NURSE", false)).toBeNull();
  });

  it("says when the visit already moved on", () => {
    expect(assessmentFailureFollowUp("WAITING_FOR_DOCTOR", true)).toMatch(/already been sent/);
    expect(assessmentFailureFollowUp("CANCELLED", false)).toMatch(/no longer with nursing/);
  });
});
