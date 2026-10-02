import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { seedTestUsers, closeTestPool, createTestPatient, TEST_PASSWORD } from "./setup";

/**
 * GET /api/v1/patients/:id/history — a patient's other visits, each with
 * consultations + diagnoses, prescriptions, lab orders + results and vitals.
 * Every fixture is built through the real workflow endpoints, and every
 * assertion is scoped to the patients this file created.
 */

const app = createApp();
const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";

async function loginAs(username: string) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ username, password: TEST_PASSWORD });
  return agent;
}

const historyUrl = (patientId: string, excludeVisitId?: string) =>
  `/api/v1/patients/${patientId}/history${excludeVisitId ? `?excludeVisitId=${excludeVisitId}` : ""}`;

async function newPatient() {
  return createTestPatient(`History Patient ${Date.now()}-${Math.random()}`);
}

async function createVisit(patientId: string) {
  const reception = await loginAs("test.reception");
  const res = await reception.post("/api/v1/visits").send({ patientId });
  return res.body.data.visit.id as string;
}

/**
 * One visit through the whole workflow to COMPLETED: nurse vitals and
 * assessment; a consultation with a diagnosis, a lab order and a
 * prescription; the lab round with results; a review consultation;
 * dispensing; billing. `tag` makes each visit's clinical text unique.
 */
async function completeFullVisit(patientId: string, tag: string) {
  const reception = await loginAs("test.reception");
  const nurse = await loginAs("test.nurse");
  const doctor = await loginAs("test.doctor");
  const lab = await loginAs("test.lab");
  const pharmacy = await loginAs("test.pharmacy");
  const owner = await loginAs("test.owner");

  const visitId = await createVisit(patientId);
  await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_NURSE" });
  await nurse.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_NURSE" });
  await nurse
    .post(`/api/v1/visits/${visitId}/vitals`)
    .send({ bloodPressureSystolic: 120, bloodPressureDiastolic: 80, pulseBpm: 72, temperatureCelsius: 37.5 });
  await nurse.post(`/api/v1/visits/${visitId}/nursing-assessment`).send({ chiefComplaint: `Fever (${tag})` }); // -> WAITING_FOR_DOCTOR

  const c1 = (await doctor.post(`/api/v1/visits/${visitId}/consultations`)).body.data.consultation.id as string;
  await doctor.post(`/api/v1/consultations/${c1}/diagnoses`).send({ description: `Malaria (${tag})` });
  const orderId = (await doctor.post(`/api/v1/consultations/${c1}/lab-orders`).send({ testNames: [`Malaria RDT ${tag}`] }))
    .body.data.labOrder.id as string;
  const rxId = (
    await doctor
      .post(`/api/v1/consultations/${c1}/prescriptions`)
      .send({ items: [{ medicineName: `Artemether ${tag}`, dosage: "1 tab", quantityPrescribed: 6 }] })
  ).body.data.prescription.id as string;
  await doctor.post(`/api/v1/consultations/${c1}/complete`); // -> WAITING_FOR_LAB

  await lab.post(`/api/v1/laboratory/orders/${orderId}/start`);
  const order = (await lab.get(`/api/v1/laboratory/orders/${orderId}`)).body.data.order;
  await lab
    .post(`/api/v1/laboratory/orders/${orderId}/results`)
    .send({ results: order.items.map((i: { id: string }) => ({ itemId: i.id, result: `Positive (${tag})` })) });
  await lab.post(`/api/v1/laboratory/orders/${orderId}/complete`); // -> LAB_COMPLETED

  await doctor.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_DOCTOR" });
  const c2 = (await doctor.post(`/api/v1/visits/${visitId}/consultations`)).body.data.consultation.id as string;
  await doctor.post(`/api/v1/consultations/${c2}/complete`); // pending prescription -> WAITING_FOR_PHARMACY

  const stockId = (
    await owner
      .post("/api/v1/inventory/items")
      .send({ name: `History Stock ${Date.now()}-${Math.random()}`, unit: "tablet", quantityOnHand: 100 })
  ).body.data.item.id as string;
  await pharmacy.post(`/api/v1/pharmacy/prescriptions/${rxId}/start`);
  const rx = (await pharmacy.get(`/api/v1/pharmacy/prescriptions/${rxId}`)).body.data.prescription;
  await pharmacy
    .post(`/api/v1/pharmacy/prescriptions/${rxId}/dispense`)
    .send({ items: [{ itemId: rx.items[0].id, inventoryItemId: stockId, quantity: 6 }] });
  await pharmacy.post(`/api/v1/pharmacy/prescriptions/${rxId}/complete`); // -> WAITING_FOR_BILLING

  const invoiceId = (await reception.post(`/api/v1/billing/visits/${visitId}/invoice`)).body.data.invoice.id as string;
  await reception.post(`/api/v1/billing/invoices/${invoiceId}/items`).send({ items: [{ description: "Consultation", quantity: 1, unitPrice: 100 }] });
  await reception.post(`/api/v1/billing/invoices/${invoiceId}/payments`).send({ amount: 100, method: "cash" });
  const completeRes = await reception.post(`/api/v1/billing/invoices/${invoiceId}/complete`);
  expect(completeRes.body.data.visitStatus).toBe("COMPLETED");

  return { visitId, stockId };
}

/** The visit being worked on now: at the doctor with an open consultation. */
async function openCurrentVisit(patientId: string) {
  const reception = await loginAs("test.reception");
  const doctor = await loginAs("test.doctor");
  const visitId = await createVisit(patientId);
  await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_DOCTOR" });
  await doctor.post(`/api/v1/visits/${visitId}/consultations`);
  return visitId;
}

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await closeTestPool();
});

describe("GET /api/v1/patients/:id/history — full nested detail", () => {
  let patientId: string;
  let first: { visitId: string; stockId: string };
  let second: { visitId: string; stockId: string };
  let currentVisitId: string;

  beforeAll(async () => {
    patientId = (await newPatient()).id;
    first = await completeFullVisit(patientId, "first");
    second = await completeFullVisit(patientId, "second");
    currentVisitId = await openCurrentVisit(patientId);
  }, 120_000);

  it("returns every past visit, newest first, excluding the current one", async () => {
    const doctor = await loginAs("test.doctor");
    const res = await doctor.get(historyUrl(patientId, currentVisitId));
    expect(res.status).toBe(200);
    expect(res.body.data.visits.map((v: { id: string }) => v.id)).toEqual([second.visitId, first.visitId]);
    expect(res.body.data.visits.every((v: { status: string }) => v.status === "COMPLETED")).toBe(true);
  });

  it("each visit carries its consultations with diagnoses, prescriptions, lab results and vitals", async () => {
    const doctor = await loginAs("test.doctor");
    const res = await doctor.get(historyUrl(patientId, currentVisitId));
    const visit = res.body.data.visits.find((v: { id: string }) => v.id === first.visitId);

    expect(visit.patientId).toBe(patientId);
    expect(visit.completedAt).not.toBeNull();

    // Two consultations (initial + post-lab review), oldest first; the diagnosis is on the first.
    expect(visit.consultations).toHaveLength(2);
    expect(visit.consultations[0].diagnoses.map((d: { description: string }) => d.description)).toEqual(["Malaria (first)"]);
    expect(visit.consultations[1].diagnoses).toEqual([]);

    expect(visit.prescriptions).toHaveLength(1);
    expect(visit.prescriptions[0].items).toEqual([
      expect.objectContaining({ medicineName: "Artemether first", dosage: "1 tab", quantityPrescribed: 6, quantityDispensed: 6, status: "DISPENSED" }),
    ]);

    expect(visit.labOrders).toHaveLength(1);
    expect(visit.labOrders[0].status).toBe("COMPLETED");
    expect(visit.labOrders[0].items).toEqual([
      expect.objectContaining({ testName: "Malaria RDT first", result: "Positive (first)" }),
    ]);

    expect(visit.vitals).toHaveLength(1);
    expect(visit.vitals[0]).toMatchObject({ bloodPressureSystolic: 120, bloodPressureDiastolic: 80, pulseBpm: 72, temperatureCelsius: "37.5" });
  });

  it("does not mix records between visits", async () => {
    const doctor = await loginAs("test.doctor");
    const res = await doctor.get(historyUrl(patientId, currentVisitId));
    const visit = res.body.data.visits.find((v: { id: string }) => v.id === second.visitId);
    expect(visit.consultations[0].diagnoses[0].description).toBe("Malaria (second)");
    expect(visit.prescriptions[0].items[0].medicineName).toBe("Artemether second");
    expect(visit.labOrders[0].items[0].result).toBe("Positive (second)");
    const allVisitIds = [
      ...visit.consultations.map((c: { visitId: string }) => c.visitId),
      ...visit.prescriptions.map((p: { visitId: string }) => p.visitId),
      ...visit.labOrders.map((o: { visitId: string }) => o.visitId),
      ...visit.vitals.map((v: { visitId: string }) => v.visitId),
    ];
    expect(new Set(allVisitIds)).toEqual(new Set([second.visitId]));
  });

  it("without excludeVisitId, the current visit is included too (newest first)", async () => {
    const doctor = await loginAs("test.doctor");
    const res = await doctor.get(historyUrl(patientId));
    expect(res.body.data.visits.map((v: { id: string }) => v.id)).toEqual([currentVisitId, second.visitId, first.visitId]);
    const current = res.body.data.visits[0];
    expect(current.status).toBe("WITH_DOCTOR");
    expect(current.consultations).toHaveLength(1);
    expect(current.prescriptions).toEqual([]);
  });

  it("an excludeVisitId belonging to another patient excludes nothing", async () => {
    const doctor = await loginAs("test.doctor");
    const otherVisitId = await createVisit((await newPatient()).id);
    const res = await doctor.get(historyUrl(patientId, otherVisitId));
    expect(res.body.data.visits).toHaveLength(3);
  });

  it("redacts inventoryItemId exactly as GET /visits/:id/prescriptions does", async () => {
    const doctor = await loginAs("test.doctor");
    const owner = await loginAs("test.owner");
    const asDoctor = await doctor.get(historyUrl(patientId, currentVisitId));
    const asOwner = await owner.get(historyUrl(patientId, currentVisitId));
    const itemOf = (res: request.Response) =>
      res.body.data.visits.find((v: { id: string }) => v.id === first.visitId).prescriptions[0].items[0];
    expect(itemOf(asDoctor).inventoryItemId).toBeNull();
    expect(itemOf(asOwner).inventoryItemId).toBe(first.stockId);

    const perVisit = await doctor.get(`/api/v1/visits/${first.visitId}/prescriptions`);
    const fromHistory = asDoctor.body.data.visits.find((v: { id: string }) => v.id === first.visitId).prescriptions;
    expect(fromHistory).toEqual(perVisit.body.data.prescriptions);
  });

  it("matches the per-visit read routes it aggregates", async () => {
    const doctor = await loginAs("test.doctor");
    const res = await doctor.get(historyUrl(patientId, currentVisitId));
    const visit = res.body.data.visits.find((v: { id: string }) => v.id === first.visitId);
    const [consultations, orders, vitals] = await Promise.all([
      doctor.get(`/api/v1/visits/${first.visitId}/consultations`),
      doctor.get(`/api/v1/visits/${first.visitId}/lab-orders`),
      doctor.get(`/api/v1/visits/${first.visitId}/vitals`),
    ]);
    expect(visit.consultations).toEqual(consultations.body.data.consultations);
    expect(visit.labOrders).toEqual(orders.body.data.orders);
    expect(visit.vitals).toEqual(vitals.body.data.vitals);
  });
});

describe("GET /api/v1/patients/:id/history — no past visits", () => {
  it("a patient with no visits at all → empty array, not an error", async () => {
    const doctor = await loginAs("test.doctor");
    const patient = await newPatient();
    const res = await doctor.get(historyUrl(patient.id));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ visits: [] });
  });

  it("a patient whose only visit is the current one → empty array", async () => {
    const doctor = await loginAs("test.doctor");
    const patient = await newPatient();
    const currentVisitId = await openCurrentVisit(patient.id);
    const res = await doctor.get(historyUrl(patient.id, currentVisitId));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ visits: [] });
  });
});

describe("GET /api/v1/patients/:id/history — validation and access", () => {
  it("401 without a session", async () => {
    const res = await request(app).get(historyUrl(UNKNOWN_ID));
    expect(res.status).toBe(401);
  });

  it("200 for doctor and owner, 403 for reception/nurse/lab/pharmacy", async () => {
    const patient = await newPatient();
    for (const username of ["test.doctor", "test.owner"]) {
      const agent = await loginAs(username);
      const res = await agent.get(historyUrl(patient.id));
      expect(res.status, username).toBe(200);
    }
    for (const username of ["test.reception", "test.nurse", "test.lab", "test.pharmacy"]) {
      const agent = await loginAs(username);
      const res = await agent.get(historyUrl(patient.id));
      expect(res.status, username).toBe(403);
      expect(res.body.error.code, username).toBe("FORBIDDEN");
    }
  });

  it("an inactive account cannot log in, so cannot read it", async () => {
    const agent = await loginAs("test.inactive");
    const res = await agent.get(historyUrl(UNKNOWN_ID));
    expect(res.status).toBe(401);
  });

  it("400 for a malformed patient id", async () => {
    const doctor = await loginAs("test.doctor");
    const res = await doctor.get("/api/v1/patients/not-a-uuid/history");
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("Invalid id format");
  });

  it("400 for a malformed excludeVisitId, and for unknown query parameters", async () => {
    const doctor = await loginAs("test.doctor");
    const patient = await newPatient();
    const bad = await doctor.get(`/api/v1/patients/${patient.id}/history?excludeVisitId=nope`);
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.excludeVisitId).toBeDefined();
    const unknown = await doctor.get(`/api/v1/patients/${patient.id}/history?limit=5`);
    expect(unknown.status).toBe(400);
  });

  it("404 for a well-formed but unknown patient id", async () => {
    const doctor = await loginAs("test.doctor");
    const res = await doctor.get(historyUrl(UNKNOWN_ID));
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe("Patient not found");
  });
});
