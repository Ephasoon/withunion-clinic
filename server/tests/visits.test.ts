import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
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

  it("full happy-path chain: reception -> nurse -> doctor -> lab -> doctor -> billing -> reception completes", async () => {
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

    const doctor = await loginAs("test.doctor");
    res = await doctor.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_DOCTOR" });
    expect(res.body.data.visit.status).toBe("WITH_DOCTOR");

    res = await doctor.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_LAB" });
    expect(res.body.data.visit.status).toBe("WAITING_FOR_LAB");

    // Pharmacy cannot pull a patient out of the lab queue.
    const pharmacy = await loginAs("test.pharmacy");
    const pharmacyOverreach = await pharmacy
      .post(`/api/v1/visits/${visitId}/transition`)
      .send({ toStatus: "AT_LAB" });
    expect(pharmacyOverreach.status).toBe(403);

    const lab = await loginAs("test.lab");
    res = await lab.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "AT_LAB" });
    expect(res.body.data.visit.status).toBe("AT_LAB");

    res = await lab.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "LAB_COMPLETED" });
    expect(res.body.data.visit.status).toBe("LAB_COMPLETED");

    res = await doctor.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_DOCTOR" });
    expect(res.body.data.visit.status).toBe("WITH_DOCTOR");

    res = await doctor.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_BILLING" });
    expect(res.body.data.visit.status).toBe("WAITING_FOR_BILLING");

    // Only reception can close billing and complete the visit.
    const doctorOverreach = await doctor
      .post(`/api/v1/visits/${visitId}/transition`)
      .send({ toStatus: "COMPLETED" });
    expect(doctorOverreach.status).toBe(403);

    res = await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "COMPLETED" });
    expect(res.status).toBe(200);
    expect(res.body.data.visit.status).toBe("COMPLETED");

    const detail = await reception.get(`/api/v1/visits/${visitId}`);
    // creation + 10 successful transitions (WAITING_FOR_NURSE, WITH_NURSE,
    // WAITING_FOR_DOCTOR, WITH_DOCTOR, WAITING_FOR_LAB, AT_LAB, LAB_COMPLETED,
    // WITH_DOCTOR again, WAITING_FOR_BILLING, COMPLETED) = 11 ledger rows.
    // The three rejected overreach attempts write nothing.
    expect(detail.body.data.history).toHaveLength(11);
  });

  it("doctor can send a visit straight to billing when no lab/pharmacy is needed", async () => {
    const { reception, visitId } = await createVisitAsReception();
    await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_NURSE" });
    const nurse = await loginAs("test.nurse");
    await nurse.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_NURSE" });
    await nurse.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_DOCTOR" });
    const doctor = await loginAs("test.doctor");
    await doctor.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_DOCTOR" });

    const res = await doctor.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_BILLING" });
    expect(res.status).toBe(200);
    expect(res.body.data.visit.status).toBe("WAITING_FOR_BILLING");
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
