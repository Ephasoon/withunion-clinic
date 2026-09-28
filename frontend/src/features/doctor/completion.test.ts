import { describe, expect, it } from "vitest";
import { describeCompletionOutcome, previewCompletion } from "./completion";
import type { LabOrderDetail, PrescriptionItemStatus } from "./types";

const order = (status: "REQUESTED" | "COMPLETED", tests: string[]): Pick<LabOrderDetail, "status" | "items"> => ({
  status,
  items: tests.map((testName, i) => ({
    id: `${status}-${i}`,
    testName,
    result: status === "COMPLETED" ? "Normal" : null,
    resultEnteredBy: null,
    resultEnteredAt: null,
  })),
});

const prescription = (...items: Array<[string, PrescriptionItemStatus]>) => ({
  items: items.map(([medicineName, status], i) => ({
    id: `${medicineName}-${i}`,
    medicineName,
    strength: null,
    dosage: null,
    frequency: null,
    duration: null,
    quantityPrescribed: null,
    quantityDispensed: null,
    status,
    inventoryItemId: null,
    dispensedBy: null,
    dispensedAt: null,
  })),
});

describe("previewCompletion — mirrors the backend's visit-wide routing", () => {
  it("goes to the lab when any lab order on the visit is REQUESTED", () => {
    const preview = previewCompletion([order("REQUESTED", ["CBC", "Malaria RDT"])], []);
    expect(preview.destination).toBe("WAITING_FOR_LAB");
    expect(preview.reason).toContain("CBC, Malaria RDT");
  });

  it("the lab takes priority over pending medicines", () => {
    expect(
      previewCompletion([order("REQUESTED", ["CBC"])], [prescription(["Amoxicillin", "PENDING"])]).destination
    ).toBe("WAITING_FOR_LAB");
  });

  it("ignores lab orders already COMPLETED by an earlier lab round", () => {
    expect(previewCompletion([order("COMPLETED", ["CBC"])], []).destination).toBe("WAITING_FOR_BILLING");
  });

  it("goes to the pharmacy when no lab order is outstanding and any item is PENDING", () => {
    const preview = previewCompletion(
      [order("COMPLETED", ["CBC"])],
      [prescription(["Paracetamol", "DISPENSED"]), prescription(["Amoxicillin", "PENDING"])]
    );
    expect(preview.destination).toBe("WAITING_FOR_PHARMACY");
    expect(preview.reason).toContain("Amoxicillin");
    expect(preview.reason).not.toContain("Paracetamol");
  });

  it("counts only PENDING items: partly dispensed, dispensed and unavailable do not route to pharmacy", () => {
    expect(
      previewCompletion(
        [],
        [prescription(["A", "PARTIALLY_DISPENSED"], ["B", "DISPENSED"], ["C", "UNAVAILABLE"])]
      ).destination
    ).toBe("WAITING_FOR_BILLING");
  });

  it("goes to billing when nothing is outstanding", () => {
    const preview = previewCompletion([], []);
    expect(preview.destination).toBe("WAITING_FOR_BILLING");
    expect(preview.headline).toBe("The patient will go to billing.");
  });
});

describe("describeCompletionOutcome", () => {
  it("says where the patient went and why", () => {
    expect(describeCompletionOutcome("WAITING_FOR_LAB")).toMatch(/sent to the lab/);
    expect(describeCompletionOutcome("WAITING_FOR_PHARMACY")).toMatch(/sent to the pharmacy/);
    expect(describeCompletionOutcome("WAITING_FOR_BILLING")).toMatch(/sent to billing/);
  });

  it("falls back to the raw status for anything unexpected", () => {
    expect(describeCompletionOutcome("SOMETHING_NEW")).toBe("Consultation completed. The visit is now SOMETHING_NEW.");
  });
});
