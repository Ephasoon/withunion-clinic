import { describe, expect, it } from "vitest";
import { assessmentFormFrom, validateAssessmentForm } from "./assessmentForm";

describe("validateAssessmentForm", () => {
  it("requires the chief complaint or notes", () => {
    const result = validateAssessmentForm({ chiefComplaint: "  ", assessmentNotes: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.form).toMatch(/chief complaint or assessment notes/);
  });

  it("trims and omits blank fields", () => {
    expect(validateAssessmentForm({ chiefComplaint: " Headache ", assessmentNotes: "  " })).toEqual({
      ok: true,
      body: { chiefComplaint: "Headache" },
    });
    expect(validateAssessmentForm({ chiefComplaint: "", assessmentNotes: " Alert " })).toEqual({
      ok: true,
      body: { assessmentNotes: "Alert" },
    });
  });

  it("enforces the backend limits: 2000 for the complaint, 4000 for notes", () => {
    expect(validateAssessmentForm({ chiefComplaint: "c".repeat(2000), assessmentNotes: "n".repeat(4000) }).ok).toBe(true);
    const tooLong = validateAssessmentForm({ chiefComplaint: "c".repeat(2001), assessmentNotes: "n".repeat(4001) });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) {
      expect(tooLong.errors.chiefComplaint).toBeDefined();
      expect(tooLong.errors.assessmentNotes).toBeDefined();
    }
  });
});

describe("assessmentFormFrom", () => {
  it("pre-fills from a saved assessment, and starts empty without one", () => {
    expect(
      assessmentFormFrom({
        id: "a1",
        visitId: "v1",
        nurseId: "n1",
        chiefComplaint: "Headache",
        assessmentNotes: null,
        createdAt: "2026-09-28T08:00:00.000Z",
      })
    ).toEqual({ chiefComplaint: "Headache", assessmentNotes: "" });
    expect(assessmentFormFrom(null)).toEqual({ chiefComplaint: "", assessmentNotes: "" });
  });
});
