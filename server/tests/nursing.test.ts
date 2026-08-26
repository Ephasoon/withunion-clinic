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

/** Creates a visit and advances it to WITH_NURSE, ready for nursing actions. */
async function createVisitWithNurse() {
  const reception = await loginAs("test.reception");
  const patient = await createTestPatient(`Nursing Test Patient ${Date.now()}-${Math.random()}`);
  const createRes = await reception.post("/api/v1/visits").send({ patientId: patient.id });
  const visitId = createRes.body.data.visit.id as string;

  await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_NURSE" });

  const nurse = await loginAs("test.nurse");
  await nurse.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_NURSE" });

  return { reception, nurse, visitId };
}

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await closeTestPool();
});

describe("POST /api/v1/visits/:id/vitals", () => {
  it("rejects an unauthenticated request", async () => {
    const { visitId } = await createVisitWithNurse();
    const res = await request(app).post(`/api/v1/visits/${visitId}/vitals`).send({ pulseBpm: 80 });
    expect(res.status).toBe(401);
  });

  it("rejects a non-nurse role (e.g. reception)", async () => {
    const { reception, visitId } = await createVisitWithNurse();
    const res = await reception.post(`/api/v1/visits/${visitId}/vitals`).send({ pulseBpm: 80 });
    expect(res.status).toBe(403);
  });

  it("rejects a doctor from writing vitals", async () => {
    const { visitId } = await createVisitWithNurse();
    const doctor = await loginAs("test.doctor");
    const res = await doctor.post(`/api/v1/visits/${visitId}/vitals`).send({ pulseBpm: 80 });
    expect(res.status).toBe(403);
  });

  it("rejects an out-of-range value", async () => {
    const { nurse, visitId } = await createVisitWithNurse();
    const res = await nurse.post(`/api/v1/visits/${visitId}/vitals`).send({ pulseBpm: 9999 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects unknown fields (strict schema)", async () => {
    const { nurse, visitId } = await createVisitWithNurse();
    const res = await nurse.post(`/api/v1/visits/${visitId}/vitals`).send({ pulseBpm: 80, notAField: 1 });
    expect(res.status).toBe(400);
  });

  it("rejects recording vitals when the visit is not WITH_NURSE", async () => {
    const reception = await loginAs("test.reception");
    const patient = await createTestPatient(`Wrong State Patient ${Date.now()}`);
    const createRes = await reception.post("/api/v1/visits").send({ patientId: patient.id });
    const visitId = createRes.body.data.visit.id; // still REGISTERED, not WITH_NURSE

    const nurse = await loginAs("test.nurse");
    const res = await nurse.post(`/api/v1/visits/${visitId}/vitals`).send({ pulseBpm: 80 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_VISIT_STATE");
  });

  it("nurse can record vitals for a visit that is WITH_NURSE", async () => {
    const { nurse, visitId } = await createVisitWithNurse();
    const res = await nurse.post(`/api/v1/visits/${visitId}/vitals`).send({
      bloodPressureSystolic: 120,
      bloodPressureDiastolic: 80,
      pulseBpm: 76,
      temperatureCelsius: 36.7,
      weightKg: 68.5,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.vitals.pulseBpm).toBe(76);
    expect(res.body.data.vitals.visitId).toBe(visitId);
  });

  it("allows retaking vitals — repeatable, not upserted", async () => {
    const { nurse, visitId } = await createVisitWithNurse();
    await nurse.post(`/api/v1/visits/${visitId}/vitals`).send({ pulseBpm: 76 });
    await nurse.post(`/api/v1/visits/${visitId}/vitals`).send({ pulseBpm: 81 });

    const res = await nurse.get(`/api/v1/visits/${visitId}/vitals`);
    expect(res.status).toBe(200);
    expect(res.body.data.vitals).toHaveLength(2);
    expect(res.body.data.vitals[0].pulseBpm).toBe(76);
    expect(res.body.data.vitals[1].pulseBpm).toBe(81);
  });
});

describe("GET /api/v1/visits/:id/vitals", () => {
  it("rejects unauthenticated access", async () => {
    const { visitId } = await createVisitWithNurse();
    const res = await request(app).get(`/api/v1/visits/${visitId}/vitals`);
    expect(res.status).toBe(401);
  });

  it("allows a non-nurse clinical role (doctor) to view vitals — read access for all roles", async () => {
    const { nurse, visitId } = await createVisitWithNurse();
    await nurse.post(`/api/v1/visits/${visitId}/vitals`).send({ pulseBpm: 70 });

    const doctor = await loginAs("test.doctor");
    const res = await doctor.get(`/api/v1/visits/${visitId}/vitals`);
    expect(res.status).toBe(200);
    expect(res.body.data.vitals.length).toBeGreaterThan(0);
  });
});

describe("POST /api/v1/visits/:id/nursing-assessment", () => {
  it("rejects an unauthenticated request", async () => {
    const { visitId } = await createVisitWithNurse();
    const res = await request(app)
      .post(`/api/v1/visits/${visitId}/nursing-assessment`)
      .send({ chiefComplaint: "Fever" });
    expect(res.status).toBe(401);
  });

  it("rejects a non-nurse role", async () => {
    const { reception, visitId } = await createVisitWithNurse();
    const res = await reception
      .post(`/api/v1/visits/${visitId}/nursing-assessment`)
      .send({ chiefComplaint: "Fever" });
    expect(res.status).toBe(403);
  });

  it("rejects when the visit is not WITH_NURSE", async () => {
    const reception = await loginAs("test.reception");
    const patient = await createTestPatient(`Wrong State Assessment ${Date.now()}`);
    const createRes = await reception.post("/api/v1/visits").send({ patientId: patient.id });
    const visitId = createRes.body.data.visit.id; // still REGISTERED

    const nurse = await loginAs("test.nurse");
    const res = await nurse
      .post(`/api/v1/visits/${visitId}/nursing-assessment`)
      .send({ chiefComplaint: "Headache" });
    expect(res.status).toBe(409);
  });

  it("records the assessment and auto-advances the visit to WAITING_FOR_DOCTOR", async () => {
    const { nurse, visitId } = await createVisitWithNurse();
    const res = await nurse.post(`/api/v1/visits/${visitId}/nursing-assessment`).send({
      chiefComplaint: "Persistent cough",
      assessmentNotes: "No fever, mild wheeze on auscultation",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.assessment.chiefComplaint).toBe("Persistent cough");
    expect(res.body.data.visitStatus).toBe("WAITING_FOR_DOCTOR");

    // Confirm the visit really moved, via the Visits API itself —
    // not just trusting the nursing response.
    const detail = await nurse.get(`/api/v1/visits/${visitId}`);
    expect(detail.body.data.visit.status).toBe("WAITING_FOR_DOCTOR");
    const lastEvent = detail.body.data.history[detail.body.data.history.length - 1];
    expect(lastEvent.fromStatus).toBe("WITH_NURSE");
    expect(lastEvent.toStatus).toBe("WAITING_FOR_DOCTOR");
  });

  it("rejects a second assessment submission once the visit has left WITH_NURSE", async () => {
    const { nurse, visitId } = await createVisitWithNurse();
    await nurse.post(`/api/v1/visits/${visitId}/nursing-assessment`).send({ chiefComplaint: "First" });

    // Visit is now WAITING_FOR_DOCTOR — nursing actions are no longer valid.
    const res = await nurse
      .post(`/api/v1/visits/${visitId}/nursing-assessment`)
      .send({ chiefComplaint: "Second attempt" });
    expect(res.status).toBe(409);
  });

  it("a doctor cannot fire the nursing hand-off transition directly to bypass nursing", async () => {
    const { visitId } = await createVisitWithNurse();
    const doctor = await loginAs("test.doctor");
    const res = await doctor
      .post(`/api/v1/visits/${visitId}/transition`)
      .send({ toStatus: "WAITING_FOR_DOCTOR" });
    expect(res.status).toBe(403); // WITH_NURSE -> WAITING_FOR_DOCTOR is nurse-only, per existing QUEUE_TRANSITIONS
  });
});
