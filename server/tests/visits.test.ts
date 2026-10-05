import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { pool } from "../src/config/db";
import { seedTestUsers, closeTestPool, createTestPatient, TEST_PASSWORD } from "./setup";

const app = createApp();

async function loginAs(username: string) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ username, password: TEST_PASSWORD });
  return agent;
}

async function createVisitAsReception() {
  const reception = await loginAs("test.reception");
  const patient = await createTestPatient(`Visit Test Patient ${Date.now()}-${Math.random()}`);
  const res = await reception.post("/api/v1/visits").send({ patientId: patient.id });
  return { reception, visitId: res.body.data.visit.id as string, res };
}

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await closeTestPool();
});

describe("POST /api/v1/visits (create)", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).post("/api/v1/visits").send({ patientId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(401);
  });

  it("rejects a non-reception role (e.g. nurse)", async () => {
    const nurse = await loginAs("test.nurse");
    const res = await nurse.post("/api/v1/visits").send({ patientId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(403);
  });

  it("rejects a non-existent patient id", async () => {
    const reception = await loginAs("test.reception");
    const res = await reception.post("/api/v1/visits").send({ patientId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(404);
  });

  it("rejects a malformed patientId", async () => {
    const reception = await loginAs("test.reception");
    const res = await reception.post("/api/v1/visits").send({ patientId: "not-a-uuid" });
    expect(res.status).toBe(400);
  });

  it("creates a visit in REGISTERED status with one queue_events row", async () => {
    const { visitId, res } = await createVisitAsReception();
    expect(res.status).toBe(201);
    expect(res.body.data.visit.status).toBe("REGISTERED");

    const reception = await loginAs("test.reception");
    const detail = await reception.get(`/api/v1/visits/${visitId}`);
    expect(detail.body.data.history).toHaveLength(1);
    expect(detail.body.data.history[0].fromStatus).toBeNull();
    expect(detail.body.data.history[0].toStatus).toBe("REGISTERED");
  });
});

describe("GET /api/v1/visits/:id", () => {
  it("rejects unauthenticated access", async () => {
    const { visitId } = await createVisitAsReception();
    const res = await request(app).get(`/api/v1/visits/${visitId}`);
    expect(res.status).toBe(401);
  });

  it("returns 404 for a non-existent visit", async () => {
    const reception = await loginAs("test.reception");
    const res = await reception.get("/api/v1/visits/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed id", async () => {
    const reception = await loginAs("test.reception");
    const res = await reception.get("/api/v1/visits/not-a-uuid");
    expect(res.status).toBe(400);
  });
});

describe("Role-controlled queue transitions (Phase 1 §4.4)", () => {
  it("allows reception to move REGISTERED -> WAITING_FOR_NURSE", async () => {
    const { reception, visitId } = await createVisitAsReception();
    const res = await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_NURSE" });
    expect(res.status).toBe(200);
    expect(res.body.data.visit.status).toBe("WAITING_FOR_NURSE");
  });

  it("blocks a nurse from acting before the visit reaches WAITING_FOR_NURSE", async () => {
    const { visitId } = await createVisitAsReception(); // still REGISTERED
    const nurse = await loginAs("test.nurse");
    const res = await nurse.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_NURSE" });
    expect(res.status).toBe(403);
  });

  it("full happy-path chain: reception -> nurse -> doctor -> lab -> doctor -> billing, with module-owned steps refused on the generic endpoint", async () => {
    const { reception, visitId } = await createVisitAsReception();

    let res = await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_NURSE" });
    expect(res.body.data.visit.status).toBe("WAITING_FOR_NURSE");

    const nurse = await loginAs("test.nurse");
    res = await nurse.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_NURSE" });
    expect(res.body.data.visit.status).toBe("WITH_NURSE");

    res = await nurse.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_DOCTOR" });
    expect(res.body.data.visit.status).toBe("WAITING_FOR_DOCTOR");

    // Nurse cannot leapfrog into the doctor's own step.
    const nurseOverreach = await nurse
      .post(`/api/v1/visits/${visitId}/transition`)
      .send({ toStatus: "WITH_DOCTOR" });
    expect(nurseOverreach.status).toBe(403);

    // Opening the consultation moves the visit to WITH_DOCTOR.
    const doctor = await loginAs("test.doctor");
    const consultRes = await doctor.post(`/api/v1/visits/${visitId}/consultations`);
    const firstConsultId = consultRes.body.data.consultation.id as string;

    // Sending to lab is owned by consultation completion, not the generic endpoint.
    res = await doctor.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_LAB" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");

    const orderRes = await doctor
      .post(`/api/v1/consultations/${firstConsultId}/lab-orders`)
      .send({ testNames: ["CBC"] });
    const orderId = orderRes.body.data.labOrder.id as string;
    res = await doctor.post(`/api/v1/consultations/${firstConsultId}/complete`);
    expect(res.body.data.visitStatus).toBe("WAITING_FOR_LAB");

    // Pharmacy cannot pull a patient out of the lab queue.
    const pharmacy = await loginAs("test.pharmacy");
    const pharmacyOverreach = await pharmacy
      .post(`/api/v1/visits/${visitId}/transition`)
      .send({ toStatus: "AT_LAB" });
    expect(pharmacyOverreach.status).toBe(403);

    const lab = await loginAs("test.lab");
    res = await lab.post(`/api/v1/laboratory/orders/${orderId}/start`);
    expect(res.body.data.order.visitStatus).toBe("AT_LAB");
    const orderDetail = await lab.get(`/api/v1/laboratory/orders/${orderId}`);
    const itemId = orderDetail.body.data.order.items[0].id as string;
    await lab.post(`/api/v1/laboratory/orders/${orderId}/results`).send({ results: [{ itemId, result: "Normal" }] });

    // LAB_COMPLETED is owned by the lab completion endpoint.
    res = await lab.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "LAB_COMPLETED" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");

    res = await lab.post(`/api/v1/laboratory/orders/${orderId}/complete`);
    expect(res.body.data.order.visitStatus).toBe("LAB_COMPLETED");

    // The doctor's review pick-up has no module endpoint and stays generic.
    res = await doctor.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_DOCTOR" });
    expect(res.body.data.visit.status).toBe("WITH_DOCTOR");

    // Sending to billing is owned by consultation completion.
    res = await doctor.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_BILLING" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");

    const reviewRes = await doctor.post(`/api/v1/visits/${visitId}/consultations`);
    res = await doctor.post(`/api/v1/consultations/${reviewRes.body.data.consultation.id}/complete`);
    expect(res.body.data.visitStatus).toBe("WAITING_FOR_BILLING");

    // Only reception can close billing and complete the visit.
    const doctorOverreach = await doctor
      .post(`/api/v1/visits/${visitId}/transition`)
      .send({ toStatus: "COMPLETED" });
    expect(doctorOverreach.status).toBe(403);

    // Not even reception can complete generically — COMPLETED is only
    // reachable through Billing's completion flow (see billing.test.ts).
    res = await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "COMPLETED" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");

    const detail = await reception.get(`/api/v1/visits/${visitId}`);
    expect(detail.body.data.visit.status).toBe("WAITING_FOR_BILLING");
    // creation + 9 successful transitions (WAITING_FOR_NURSE, WITH_NURSE,
    // WAITING_FOR_DOCTOR, WITH_DOCTOR, WAITING_FOR_LAB, AT_LAB, LAB_COMPLETED,
    // WITH_DOCTOR again, WAITING_FOR_BILLING) = 10 ledger rows.
    // The seven rejected attempts write nothing.
    expect(detail.body.data.history).toHaveLength(10);
  });

  it("doctor cannot send a visit straight to billing through the generic endpoint", async () => {
    const { reception, visitId } = await createVisitAsReception();
    await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_NURSE" });
    const nurse = await loginAs("test.nurse");
    await nurse.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_NURSE" });
    await nurse.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_DOCTOR" });
    const doctor = await loginAs("test.doctor");
    await doctor.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_DOCTOR" });

    const res = await doctor.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_BILLING" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");

    const detail = await doctor.get(`/api/v1/visits/${visitId}`);
    expect(detail.body.data.visit.status).toBe("WITH_DOCTOR");

    // The real path: completing a consultation with no lab order or prescription.
    const consultRes = await doctor.post(`/api/v1/visits/${visitId}/consultations`);
    const completeRes = await doctor.post(`/api/v1/consultations/${consultRes.body.data.consultation.id}/complete`);
    expect(completeRes.body.data.visitStatus).toBe("WAITING_FOR_BILLING");
  });

  it("reception can fast-track past nursing directly to WAITING_FOR_DOCTOR", async () => {
    const { reception, visitId } = await createVisitAsReception();
    const res = await reception
      .post(`/api/v1/visits/${visitId}/transition`)
      .send({ toStatus: "WAITING_FOR_DOCTOR" });
    expect(res.status).toBe(200);
    expect(res.body.data.visit.status).toBe("WAITING_FOR_DOCTOR");
  });
});

describe("Generic completion bypass (COMPLETED is billing-only)", () => {
  /** Reaches WAITING_FOR_BILLING the real way: a consultation completed with no lab order or prescription. */
  async function createVisitWaitingForBillingViaConsultation() {
    const { reception, visitId } = await createVisitAsReception();
    await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_DOCTOR" });
    const doctor = await loginAs("test.doctor");
    const consultRes = await doctor.post(`/api/v1/visits/${visitId}/consultations`); // -> WITH_DOCTOR
    const completeRes = await doctor.post(`/api/v1/consultations/${consultRes.body.data.consultation.id}/complete`);
    expect(completeRes.body.data.visitStatus).toBe("WAITING_FOR_BILLING");
    return { reception, visitId };
  }

  it("reception cannot generically move WAITING_FOR_BILLING -> COMPLETED without an invoice", async () => {
    const { reception, visitId } = await createVisitWaitingForBillingViaConsultation();
    const before = await reception.get(`/api/v1/visits/${visitId}`);

    const res = await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "COMPLETED" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");

    const after = await reception.get(`/api/v1/visits/${visitId}`);
    expect(after.body.data.visit.status).toBe("WAITING_FOR_BILLING");
    expect(after.body.data.visit.completedAt).toBeNull();
    expect(after.body.data.history).toHaveLength(before.body.data.history.length);
  });

  it("no other role can generically complete a visit either", async () => {
    const { visitId } = await createVisitWaitingForBillingViaConsultation();
    for (const username of ["test.owner", "test.nurse", "test.doctor", "test.lab", "test.pharmacy"]) {
      const agent = await loginAs(username);
      const res = await agent.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "COMPLETED" });
      expect(res.status).toBe(403);
    }
  });

  it("owner and reception can still cancel from WAITING_FOR_BILLING", async () => {
    const { visitId } = await createVisitWaitingForBillingViaConsultation();
    const owner = await loginAs("test.owner");
    const res = await owner
      .post(`/api/v1/visits/${visitId}/transition`)
      .send({ toStatus: "CANCELLED", reason: "Patient left before paying" });
    expect(res.status).toBe(200);
    expect(res.body.data.visit.status).toBe("CANCELLED");

    const { reception, visitId: otherVisitId } = await createVisitWaitingForBillingViaConsultation();
    const receptionRes = await reception
      .post(`/api/v1/visits/${otherVisitId}/transition`)
      .send({ toStatus: "CANCELLED", reason: "Patient left before paying" });
    expect(receptionRes.status).toBe(200);
  });
});

describe("Cancellation", () => {
  it("requires a reason to cancel", async () => {
    const { reception, visitId } = await createVisitAsReception();
    const res = await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "CANCELLED" });
    expect(res.status).toBe(400);
  });

  it("reception can cancel a non-terminal visit with a reason", async () => {
    const { reception, visitId } = await createVisitAsReception();
    const res = await reception
      .post(`/api/v1/visits/${visitId}/transition`)
      .send({ toStatus: "CANCELLED", reason: "Patient left before being seen" });
    expect(res.status).toBe(200);
    expect(res.body.data.visit.status).toBe("CANCELLED");
  });

  it("owner can also cancel", async () => {
    const { visitId } = await createVisitAsReception();
    const owner = await loginAs("test.owner");
    const res = await owner
      .post(`/api/v1/visits/${visitId}/transition`)
      .send({ toStatus: "CANCELLED", reason: "Duplicate registration" });
    expect(res.status).toBe(200);
  });
});

describe("Terminal-state protection", () => {
  it("rejects any further transition once a visit is CANCELLED", async () => {
    const { reception, visitId } = await createVisitAsReception();
    await reception
      .post(`/api/v1/visits/${visitId}/transition`)
      .send({ toStatus: "CANCELLED", reason: "test cancel" });

    const res = await reception
      .post(`/api/v1/visits/${visitId}/transition`)
      .send({ toStatus: "WAITING_FOR_NURSE" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("VISIT_TERMINAL");
  });

  it("rejects re-cancelling an already-CANCELLED visit despite reception's wildcard cancel rule", async () => {
    const { reception, visitId } = await createVisitAsReception();
    await reception
      .post(`/api/v1/visits/${visitId}/transition`)
      .send({ toStatus: "CANCELLED", reason: "first cancel" });

    const res = await reception
      .post(`/api/v1/visits/${visitId}/transition`)
      .send({ toStatus: "CANCELLED", reason: "second cancel attempt" });
    expect(res.status).toBe(409);
  });
});

describe("GET /api/v1/visits/today", () => {
  it("rejects unauthenticated access", async () => {
    const res = await request(app).get("/api/v1/visits/today");
    expect(res.status).toBe(401);
  });

  it("reception sees a newly created visit in today's list", async () => {
    const { reception, visitId } = await createVisitAsReception();
    const res = await reception.get("/api/v1/visits/today");
    expect(res.status).toBe(200);
    expect(res.body.data.visits.some((v: { id: string }) => v.id === visitId)).toBe(true);
  });

  it("a nurse's today view excludes a visit still sitting at REGISTERED", async () => {
    const { visitId } = await createVisitAsReception(); // stays REGISTERED
    const nurse = await loginAs("test.nurse");
    const res = await nurse.get("/api/v1/visits/today");
    expect(res.status).toBe(200);
    expect(res.body.data.visits.some((v: { id: string }) => v.id === visitId)).toBe(false);
  });

  it("a nurse's today view includes a visit once it reaches WAITING_FOR_NURSE", async () => {
    const { reception, visitId } = await createVisitAsReception();
    await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_NURSE" });

    const nurse = await loginAs("test.nurse");
    const res = await nurse.get("/api/v1/visits/today");
    expect(res.body.data.visits.some((v: { id: string }) => v.id === visitId)).toBe(true);
  });
});

describe("POST /api/v1/visits — inactive patients (audit C3)", () => {
  async function patientWithStatus(status: "active" | "inactive") {
    const reception = await loginAs("test.reception");
    const patient = await createTestPatient(`C3 Patient ${Date.now()}-${Math.random()}`);
    if (status === "inactive") {
      const res = await reception.patch(`/api/v1/patients/${patient.id}`).send({ status: "inactive" });
      expect(res.status).toBe(200);
    }
    return { reception, patientId: patient.id };
  }

  const visitCount = async (patientId: string) =>
    Number((await pool.query(`SELECT COUNT(*) AS n FROM visits WHERE patient_id = $1`, [patientId])).rows[0].n);

  it("refuses an inactive patient with 409 PATIENT_INACTIVE and creates no visit, queue event or audit row", async () => {
    const { reception, patientId } = await patientWithStatus("inactive");
    const since = new Date();

    const res = await reception.post("/api/v1/visits").send({ patientId });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PATIENT_INACTIVE");
    expect(res.body.error.message).toBe("Patient is inactive. Reactivate the patient before creating a visit.");

    expect(await visitCount(patientId)).toBe(0);
    const events = await pool.query(
      `SELECT 1 FROM queue_events qe JOIN visits v ON v.id = qe.visit_id WHERE v.patient_id = $1`,
      [patientId]
    );
    expect(events.rowCount).toBe(0);
    const audits = await pool.query(
      `SELECT 1 FROM audit_logs WHERE action = 'visit.create' AND created_at >= $1 AND after_value->>'patientId' = $2`,
      [since, patientId]
    );
    expect(audits.rowCount).toBe(0);
  });

  it("an active patient can still be given a visit", async () => {
    const { reception, patientId } = await patientWithStatus("active");
    const res = await reception.post("/api/v1/visits").send({ patientId });
    expect(res.status).toBe(201);
    expect(res.body.data.visit.status).toBe("REGISTERED");
    expect(await visitCount(patientId)).toBe(1);
  });

  it("an unknown patient is still 404, not PATIENT_INACTIVE", async () => {
    const reception = await loginAs("test.reception");
    const res = await reception.post("/api/v1/visits").send({ patientId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.message).toBe("Patient not found");
  });

  it("reactivating the patient (PATCH status active) makes visit creation work again", async () => {
    const { reception, patientId } = await patientWithStatus("inactive");
    expect((await reception.post("/api/v1/visits").send({ patientId })).status).toBe(409);

    const reactivate = await reception.patch(`/api/v1/patients/${patientId}`).send({ status: "active" });
    expect(reactivate.status).toBe(200);

    const res = await reception.post("/api/v1/visits").send({ patientId });
    expect(res.status).toBe(201);
    expect(await visitCount(patientId)).toBe(1);
  });

  it("an open visit of a patient later set inactive is unchanged and still moves through its transitions to completion", async () => {
    const { reception, patientId } = await patientWithStatus("active");
    const visitId = (await reception.post("/api/v1/visits").send({ patientId })).body.data.visit.id as string;

    expect((await reception.patch(`/api/v1/patients/${patientId}`).send({ status: "inactive" })).status).toBe(200);

    const unchanged = await reception.get(`/api/v1/visits/${visitId}`);
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.data.visit.status).toBe("REGISTERED");
    expect(unchanged.body.data.history).toHaveLength(1);

    let res = await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_NURSE" });
    expect(res.status).toBe(200);
    const nurse = await loginAs("test.nurse");
    res = await nurse.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_NURSE" });
    expect(res.body.data.visit.status).toBe("WITH_NURSE");
    res = await nurse.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_DOCTOR" });
    expect(res.body.data.visit.status).toBe("WAITING_FOR_DOCTOR");

    const doctor = await loginAs("test.doctor");
    const consultRes = await doctor.post(`/api/v1/visits/${visitId}/consultations`);
    expect(consultRes.status).toBe(201);
    res = await doctor.post(`/api/v1/consultations/${consultRes.body.data.consultation.id}/complete`);
    expect(res.body.data.visitStatus).toBe("WAITING_FOR_BILLING");

    const invRes = await reception.post(`/api/v1/billing/visits/${visitId}/invoice`);
    expect(invRes.status).toBe(201);
    const completeRes = await reception.post(`/api/v1/billing/invoices/${invRes.body.data.invoice.id}/complete`);
    expect(completeRes.body.data.visitStatus).toBe("COMPLETED");

    // The patient is still inactive, and still can't be given a new visit.
    expect((await reception.get(`/api/v1/patients/${patientId}`)).body.data.patient.status).toBe("inactive");
    expect((await reception.post("/api/v1/visits").send({ patientId })).status).toBe(409);
  });

  it("an open visit of an inactive patient can still be cancelled", async () => {
    const { reception, patientId } = await patientWithStatus("active");
    const visitId = (await reception.post("/api/v1/visits").send({ patientId })).body.data.visit.id as string;
    await reception.patch(`/api/v1/patients/${patientId}`).send({ status: "inactive" });

    const res = await reception
      .post(`/api/v1/visits/${visitId}/transition`)
      .send({ toStatus: "CANCELLED", reason: "Patient left" });
    expect(res.status).toBe(200);
    expect(res.body.data.visit.status).toBe("CANCELLED");
  });
});
