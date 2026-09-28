import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { seedTestUsers, closeTestPool, createTestPatient, TEST_PASSWORD } from "./setup";

/**
 * Visit-scoped read routes that back a visit-detail page:
 *   GET /api/v1/visits/:id/{nursing-assessment,consultations,lab-orders,prescriptions,invoice}
 * Every fixture is built through the real workflow endpoints, and every
 * assertion is scoped to rows this file created.
 */

const app = createApp();
const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";

async function loginAs(username: string) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ username, password: TEST_PASSWORD });
  return agent;
}

/** A fresh visit sitting at REGISTERED. */
async function createVisit() {
  const reception = await loginAs("test.reception");
  const patient = await createTestPatient(`Visit Record Patient ${Date.now()}-${Math.random()}`);
  const res = await reception.post("/api/v1/visits").send({ patientId: patient.id });
  return { reception, visitId: res.body.data.visit.id as string };
}

/** REGISTERED -> WAITING_FOR_DOCTOR, then a doctor opens a consultation (-> WITH_DOCTOR). */
async function createVisitWithOpenConsultation() {
  const { reception, visitId } = await createVisit();
  await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_DOCTOR" });
  const doctor = await loginAs("test.doctor");
  const consultRes = await doctor.post(`/api/v1/visits/${visitId}/consultations`);
  return { reception, doctor, visitId, consultationId: consultRes.body.data.consultation.id as string };
}

/** Start, enter every result, and complete a lab order through the real Laboratory endpoints. */
async function completeLabRound(orderId: string) {
  const lab = await loginAs("test.lab");
  await lab.post(`/api/v1/laboratory/orders/${orderId}/start`);
  const detail = await lab.get(`/api/v1/laboratory/orders/${orderId}`);
  const results = detail.body.data.order.items.map((i: { id: string }) => ({ itemId: i.id, result: "Normal" }));
  await lab.post(`/api/v1/laboratory/orders/${orderId}/results`).send({ results });
  const res = await lab.post(`/api/v1/laboratory/orders/${orderId}/complete`);
  expect(res.body.data.order.visitStatus).toBe("LAB_COMPLETED");
}

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await closeTestPool();
});

const ROUTES = ["nursing-assessment", "consultations", "lab-orders", "prescriptions", "invoice"] as const;

describe("Shared behaviour of every visit-scoped read route", () => {
  for (const route of ROUTES) {
    it(`${route}: 401 without a session`, async () => {
      const res = await request(app).get(`/api/v1/visits/${UNKNOWN_ID}/${route}`);
      expect(res.status).toBe(401);
    });

    it(`${route}: 400 for a malformed visit id`, async () => {
      const reception = await loginAs("test.reception"); // reception may read all five
      const res = await reception.get(`/api/v1/visits/not-a-uuid/${route}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.message).toBe("Invalid visit id format");
    });

    it(`${route}: 404 for a well-formed but unknown visit id`, async () => {
      const reception = await loginAs("test.reception");
      const res = await reception.get(`/api/v1/visits/${UNKNOWN_ID}/${route}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
      expect(res.body.error.message).toBe("Visit not found");
    });
  }

  it("a visit that exists but has nothing yet returns null / empty lists, not 404", async () => {
    const { reception, visitId } = await createVisit();
    const assessment = await reception.get(`/api/v1/visits/${visitId}/nursing-assessment`);
    const consultations = await reception.get(`/api/v1/visits/${visitId}/consultations`);
    const orders = await reception.get(`/api/v1/visits/${visitId}/lab-orders`);
    const prescriptions = await reception.get(`/api/v1/visits/${visitId}/prescriptions`);
    const invoice = await reception.get(`/api/v1/visits/${visitId}/invoice`);

    expect([assessment, consultations, orders, prescriptions, invoice].map((r) => r.status)).toEqual([
      200, 200, 200, 200, 200,
    ]);
    expect(assessment.body.data).toEqual({ assessment: null });
    expect(consultations.body.data).toEqual({ consultations: [] });
    expect(orders.body.data).toEqual({ orders: [] });
    expect(prescriptions.body.data).toEqual({ prescriptions: [] });
    expect(invoice.body.data).toEqual({ invoice: null });
  });
});

describe("GET /api/v1/visits/:id/nursing-assessment", () => {
  it("returns the recorded assessment to any authenticated role", async () => {
    const { reception, visitId } = await createVisit();
    await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_NURSE" });
    const nurse = await loginAs("test.nurse");
    await nurse.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_NURSE" });
    await nurse
      .post(`/api/v1/visits/${visitId}/nursing-assessment`)
      .send({ chiefComplaint: "Headache for three days", assessmentNotes: "Alert, afebrile" });

    const pharmacy = await loginAs("test.pharmacy"); // a non-clinical-writer role can still read
    const res = await pharmacy.get(`/api/v1/visits/${visitId}/nursing-assessment`);
    expect(res.status).toBe(200);
    expect(res.body.data.assessment.visitId).toBe(visitId);
    expect(res.body.data.assessment.chiefComplaint).toBe("Headache for three days");
    expect(res.body.data.assessment.assessmentNotes).toBe("Alert, afebrile");
  });
});

describe("GET /api/v1/visits/:id/consultations and /lab-orders across two lab rounds", () => {
  /**
   * C1: diagnosis + lab order A -> lab round completes A (COMPLETED)
   * -> doctor review -> C2: diagnosis + lab order B -> completed, so B
   * stays REQUESTED in the new lab round.
   */
  async function createTwoRoundVisit() {
    const { doctor, visitId, consultationId: c1 } = await createVisitWithOpenConsultation();
    await doctor.post(`/api/v1/consultations/${c1}/diagnoses`).send({ description: "Suspected malaria" });
    const orderARes = await doctor.post(`/api/v1/consultations/${c1}/lab-orders`).send({ testNames: ["Malaria RDT"] });
    const orderA = orderARes.body.data.labOrder.id as string;
    await doctor.post(`/api/v1/consultations/${c1}/complete`); // -> WAITING_FOR_LAB
    await completeLabRound(orderA);

    await doctor.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_DOCTOR" });
    const c2Res = await doctor.post(`/api/v1/visits/${visitId}/consultations`);
    const c2 = c2Res.body.data.consultation.id as string;
    await doctor.post(`/api/v1/consultations/${c2}/diagnoses`).send({ description: "Follow-up review" });
    const orderBRes = await doctor.post(`/api/v1/consultations/${c2}/lab-orders`).send({ testNames: ["CBC"] });
    const orderB = orderBRes.body.data.labOrder.id as string;
    const c2Complete = await doctor.post(`/api/v1/consultations/${c2}/complete`);
    expect(c2Complete.body.data.visitStatus).toBe("WAITING_FOR_LAB");

    return { visitId, c1, c2, orderA, orderB };
  }

  it("lists both consultations oldest first, each with its own diagnoses", async () => {
    const { visitId, c1, c2 } = await createTwoRoundVisit();
    const nurse = await loginAs("test.nurse");
    const res = await nurse.get(`/api/v1/visits/${visitId}/consultations`);
    expect(res.status).toBe(200);

    const consultations = res.body.data.consultations;
    expect(consultations.map((c: { id: string }) => c.id)).toEqual([c1, c2]);
    expect(consultations.every((c: { visitId: string }) => c.visitId === visitId)).toBe(true);
    expect(consultations.every((c: { completedAt: string | null }) => c.completedAt !== null)).toBe(true);
    expect(consultations[0].diagnoses.map((d: { description: string }) => d.description)).toEqual([
      "Suspected malaria",
    ]);
    expect(consultations[1].diagnoses.map((d: { description: string }) => d.description)).toEqual([
      "Follow-up review",
    ]);
  });

  it("lists the COMPLETED first-round order and the REQUESTED second-round order together, oldest first", async () => {
    const { visitId, orderA, orderB } = await createTwoRoundVisit();
    const doctor = await loginAs("test.doctor");
    const res = await doctor.get(`/api/v1/visits/${visitId}/lab-orders`);
    expect(res.status).toBe(200);

    const orders = res.body.data.orders;
    expect(orders.map((o: { id: string }) => o.id)).toEqual([orderA, orderB]);
    expect(orders.map((o: { status: string }) => o.status)).toEqual(["COMPLETED", "REQUESTED"]);
    expect(orders[0].items[0].testName).toBe("Malaria RDT");
    expect(orders[0].items[0].result).toBe("Normal");
    expect(orders[1].items[0].testName).toBe("CBC");
    expect(orders[1].items[0].result).toBeNull();
  });
});

describe("GET /api/v1/visits/:id/prescriptions", () => {
  async function createDispensedVisit() {
    const { doctor, visitId, consultationId } = await createVisitWithOpenConsultation();
    const rx1Res = await doctor
      .post(`/api/v1/consultations/${consultationId}/prescriptions`)
      .send({ items: [{ medicineName: "Amoxicillin", quantityPrescribed: 5 }] });
    const rx2Res = await doctor
      .post(`/api/v1/consultations/${consultationId}/prescriptions`)
      .send({ items: [{ medicineName: "Paracetamol" }] });
    const rx1 = rx1Res.body.data.prescription.id as string;
    const rx2 = rx2Res.body.data.prescription.id as string;
    await doctor.post(`/api/v1/consultations/${consultationId}/complete`); // -> WAITING_FOR_PHARMACY

    const owner = await loginAs("test.owner");
    const stockRes = await owner
      .post("/api/v1/inventory/items")
      .send({ name: `Visit Record Stock ${Date.now()}-${Math.random()}`, unit: "capsule", quantityOnHand: 50 });
    const stockId = stockRes.body.data.item.id as string;

    const pharmacy = await loginAs("test.pharmacy");
    await pharmacy.post(`/api/v1/pharmacy/prescriptions/${rx1}/start`);
    const rx1Detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${rx1}`);
    const dispenseRes = await pharmacy.post(`/api/v1/pharmacy/prescriptions/${rx1}/dispense`).send({
      items: [{ itemId: rx1Detail.body.data.prescription.items[0].id, inventoryItemId: stockId, quantity: 5 }],
    });
    expect(dispenseRes.status).toBe(200);

    return { visitId, rx1, rx2, stockId };
  }

  it("lists every prescription oldest first, with inventoryItemId redacted for a doctor", async () => {
    const { visitId, rx1, rx2 } = await createDispensedVisit();
    const doctor = await loginAs("test.doctor");
    const res = await doctor.get(`/api/v1/visits/${visitId}/prescriptions`);
    expect(res.status).toBe(200);

    const prescriptions = res.body.data.prescriptions;
    expect(prescriptions.map((p: { id: string }) => p.id)).toEqual([rx1, rx2]);
    expect(prescriptions[0].items[0].medicineName).toBe("Amoxicillin");
    expect(prescriptions[0].items[0].status).toBe("DISPENSED");
    expect(prescriptions[0].items[0].inventoryItemId).toBeNull();
    expect(prescriptions[1].items[0].medicineName).toBe("Paracetamol");
  });

  it("shows the real inventoryItemId to pharmacy and owner", async () => {
    const { visitId, stockId } = await createDispensedVisit();
    for (const username of ["test.pharmacy", "test.owner"]) {
      const agent = await loginAs(username);
      const res = await agent.get(`/api/v1/visits/${visitId}/prescriptions`);
      expect(res.status).toBe(200);
      expect(res.body.data.prescriptions[0].items[0].inventoryItemId).toBe(stockId);
    }
  });
});

describe("GET /api/v1/visits/:id/invoice", () => {
  async function createInvoicedVisit() {
    const { doctor, visitId, consultationId } = await createVisitWithOpenConsultation();
    await doctor.post(`/api/v1/consultations/${consultationId}/complete`); // -> WAITING_FOR_BILLING
    const reception = await loginAs("test.reception");
    const invRes = await reception.post(`/api/v1/billing/visits/${visitId}/invoice`);
    const invoiceId = invRes.body.data.invoice.id as string;
    await reception
      .post(`/api/v1/billing/invoices/${invoiceId}/items`)
      .send({ items: [{ description: "Consultation", quantity: 1, unitPrice: 150 }] });
    return { visitId, invoiceId };
  }

  it("returns the visit's invoice to reception and owner", async () => {
    const { visitId, invoiceId } = await createInvoicedVisit();
    for (const username of ["test.reception", "test.owner"]) {
      const agent = await loginAs(username);
      const res = await agent.get(`/api/v1/visits/${visitId}/invoice`);
      expect(res.status).toBe(200);
      expect(res.body.data.invoice.id).toBe(invoiceId);
      expect(res.body.data.invoice.visitId).toBe(visitId);
      expect(res.body.data.invoice.status).toBe("OPEN");
      expect(res.body.data.invoice.items.map((i: { description: string }) => i.description)).toEqual([
        "Consultation",
      ]);
      expect(res.body.data.invoice.total).toBe(150);
    }
  });

  it("rejects nurse, doctor, lab tech, and pharmacy with 403", async () => {
    const { visitId } = await createInvoicedVisit();
    for (const username of ["test.nurse", "test.doctor", "test.lab", "test.pharmacy"]) {
      const agent = await loginAs(username);
      const res = await agent.get(`/api/v1/visits/${visitId}/invoice`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
  });
});
