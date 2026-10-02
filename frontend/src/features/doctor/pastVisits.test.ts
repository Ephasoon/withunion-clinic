import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPatientHistory } from "./api";
import { hasClinicalRecords, historySummary, pastVisits, visitDiagnoses } from "./pastVisits";
import type { PatientHistoryVisit } from "./types";

const visit = (id: string, createdAt: string, overrides: Partial<PatientHistoryVisit> = {}): PatientHistoryVisit => ({
  id,
  patientId: "pt1",
  patientCode: "WU-000001",
  patientFullName: "Amina Hassan",
  status: "COMPLETED",
  createdBy: "u1",
  createdAt,
  completedAt: null,
  cancelledAt: null,
  cancelReason: null,
  consultations: [],
  prescriptions: [],
  labOrders: [],
  vitals: [],
  ...overrides,
});

const diagnosis = (id: string, consultationId: string, description: string) => ({
  id,
  consultationId,
  description,
  createdAt: "2026-09-01T09:00:00.000Z",
});

const consultation = (id: string, diagnoses: ReturnType<typeof diagnosis>[]) => ({
  id,
  visitId: "v1",
  doctorId: "d1",
  notes: null,
  startedAt: "2026-09-01T09:00:00.000Z",
  completedAt: "2026-09-01T09:30:00.000Z",
  diagnoses,
});

const prescriptionWith = (medicines: string[]) =>
  ({
    id: `rx-${medicines.join("-")}`,
    items: medicines.map((medicineName, i) => ({ id: `i${i}`, medicineName })),
  }) as unknown as PatientHistoryVisit["prescriptions"][number];

const labOrderWith = (tests: string[]) =>
  ({
    id: `lo-${tests.join("-")}`,
    items: tests.map((testName, i) => ({ id: `t${i}`, testName, result: "Normal" })),
  }) as unknown as PatientHistoryVisit["labOrders"][number];

const VITALS = { id: "vs1" } as unknown as PatientHistoryVisit["vitals"][number];

describe("pastVisits", () => {
  it("drops the current visit and sorts newest first", () => {
    const visits = [
      visit("old", "2026-01-10T08:00:00.000Z"),
      visit("current", "2026-10-02T08:00:00.000Z"),
      visit("recent", "2026-09-15T08:00:00.000Z"),
    ];
    expect(pastVisits(visits, "current").map((v) => v.id)).toEqual(["recent", "old"]);
  });

  it("does not depend on the backend's order", () => {
    const visits = [visit("a", "2025-03-01T08:00:00.000Z"), visit("c", "2026-03-01T08:00:00.000Z"), visit("b", "2025-09-01T08:00:00.000Z")];
    expect(pastVisits(visits, "none").map((v) => v.id)).toEqual(["c", "b", "a"]);
  });

  it("keeps the backend's order for identical timestamps", () => {
    const at = "2026-05-05T05:05:05.000Z";
    expect(pastVisits([visit("first", at), visit("second", at)], "x").map((v) => v.id)).toEqual(["first", "second"]);
  });

  it("is empty when the only visit is the current one, or there are none", () => {
    expect(pastVisits([visit("current", "2026-10-02T08:00:00.000Z")], "current")).toEqual([]);
    expect(pastVisits([], "current")).toEqual([]);
  });

  it("does not modify the input", () => {
    const visits = [visit("a", "2025-01-01T00:00:00.000Z"), visit("b", "2026-01-01T00:00:00.000Z")];
    pastVisits(visits, "a");
    expect(visits.map((v) => v.id)).toEqual(["a", "b"]);
  });
});

describe("visitDiagnoses / hasClinicalRecords / historySummary", () => {
  it("collects diagnoses across consultations in order", () => {
    const v = visit("v", "2026-09-01T08:00:00.000Z", {
      consultations: [
        consultation("c1", [diagnosis("d1", "c1", "Malaria"), diagnosis("d2", "c1", "Dehydration")]),
        consultation("c2", []),
        consultation("c3", [diagnosis("d3", "c3", "Resolved")]),
      ],
    });
    expect(visitDiagnoses(v).map((d) => d.description)).toEqual(["Malaria", "Dehydration", "Resolved"]);
  });

  it("a visit with nothing recorded (e.g. cancelled) has no records and no summary", () => {
    const empty = visit("v", "2026-09-01T08:00:00.000Z", {
      status: "CANCELLED",
      consultations: [consultation("c1", [])],
      prescriptions: [prescriptionWith([])],
    });
    expect(hasClinicalRecords(empty)).toBe(false);
    expect(historySummary(empty)).toBeNull();
  });

  it("any one kind of record counts", () => {
    const base = "2026-09-01T08:00:00.000Z";
    expect(hasClinicalRecords(visit("v", base, { vitals: [VITALS] }))).toBe(true);
    expect(hasClinicalRecords(visit("v", base, { labOrders: [labOrderWith(["CBC"])] }))).toBe(true);
    expect(hasClinicalRecords(visit("v", base, { prescriptions: [prescriptionWith(["ORS"])] }))).toBe(true);
    expect(hasClinicalRecords(visit("v", base, { consultations: [consultation("c", [diagnosis("d", "c", "Flu")])] }))).toBe(true);
  });

  it("summarises counts with correct plurals, listing only what exists", () => {
    const full = visit("v", "2026-09-01T08:00:00.000Z", {
      consultations: [consultation("c1", [diagnosis("d1", "c1", "Malaria")])],
      prescriptions: [prescriptionWith(["Artemether", "Paracetamol"])],
      labOrders: [labOrderWith(["Malaria RDT"])],
      vitals: [VITALS],
    });
    expect(historySummary(full)).toBe("1 diagnosis · 2 medicines · 1 lab test · vitals recorded");

    const some = visit("v", "2026-09-01T08:00:00.000Z", {
      consultations: [consultation("c1", [diagnosis("d1", "c1", "A"), diagnosis("d2", "c1", "B")])],
      labOrders: [labOrderWith(["CBC"]), labOrderWith(["ESR", "CRP"])],
    });
    expect(historySummary(some)).toBe("2 diagnoses · 3 lab tests");
  });
});

describe("fetchPatientHistory — GET /api/v1/patients/:id/history", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends excludeVisitId and converts vitals' NUMERIC strings to numbers", async () => {
    const apiVisit = {
      ...visit("past", "2026-09-01T08:00:00.000Z"),
      vitals: [
        {
          id: "vs1",
          visitId: "past",
          recordedBy: "n1",
          bloodPressureSystolic: 120,
          bloodPressureDiastolic: 80,
          pulseBpm: 72,
          temperatureCelsius: "37.5",
          weightKg: "70.25",
          heightCm: null,
          respiratoryRate: null,
          oxygenSaturationPct: null,
          notes: null,
          recordedAt: "2026-09-01T08:05:00.000Z",
        },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { visits: [apiVisit] }, error: null, meta: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const visits = await fetchPatientHistory("pt1", "current-visit");
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/v1/patients/pt1/history?excludeVisitId=current-visit");
    expect(fetchMock.mock.calls[0]![1]?.method).toBe("GET");
    expect(visits[0]!.vitals[0]).toMatchObject({ temperatureCelsius: 37.5, weightKg: 70.25, heightCm: null, pulseBpm: 72 });
  });
});
