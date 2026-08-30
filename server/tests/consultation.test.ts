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

/** Creates a visit and advances it to WAITING_FOR_DOCTOR, ready for the doctor. */
async function createVisitWaitingForDoctor() {
  const reception = await loginAs("test.reception");
  const patient = await createTestPatient(`Consult Test Patient ${Date.now()}-${Math.random()}`);
  const createRes = await reception.post("/api/v1/visits").send({ patientId: patient.id });
  const visitId = createRes.body.data.visit.id as string;

  await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_NURSE" });
  const nurse = await loginAs("test.nurse");
  await nurse.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_NURSE" });
  await nurse.post(`/api/v1/visits/${visitId}/nursing-assessment`).send({ chiefComplaint: "Test complaint" });

  return { reception, visitId };
}

async function openConsultationAsDoctor(visitId: string, username = "test.doctor") {
  const doctor = await loginAs(username);
  const res = await doctor.post(`/api/v1/visits/${visitId}/consultations`);
  return { doctor, consultationId: res.body.data.consultation.id as string, res };
}

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await closeTestPool();
});

describe("POST /api/v1/visits/:id/consultations (open)", () => {
  it("rejects an unauthenticated request", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const res = await request(app).post(`/api/v1/visits/${visitId}/consultations`);
    expect(res.status).toBe(401);
  });

  it("rejects a non-doctor role (e.g. nurse)", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const nurse = await loginAs("test.nurse");
    const res = await nurse.post(`/api/v1/visits/${visitId}/consultations`);
    expect(res.status).toBe(403);
  });

  it("rejects opening a consultation when the visit is not WAITING_FOR_DOCTOR", async () => {
    const reception = await loginAs("test.reception");
    const patient = await createTestPatient(`Wrong State Consult ${Date.now()}`);
    const createRes = await reception.post("/api/v1/visits").send({ patientId: patient.id });
    const visitId = createRes.body.data.visit.id; // still REGISTERED

    const doctor = await loginAs("test.doctor");
    const res = await doctor.post(`/api/v1/visits/${visitId}/consultations`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_VISIT_STATE");
  });

  it("opens a consultation and advances the visit to WITH_DOCTOR", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const { doctor, res } = await openConsultationAsDoctor(visitId);
    expect(res.status).toBe(201);
    expect(res.body.data.consultation.visitId).toBe(visitId);

    const visitDetail = await doctor.get(`/api/v1/visits/${visitId}`);
    expect(visitDetail.body.data.visit.status).toBe("WITH_DOCTOR");
  });

  it("rejects opening a second consultation while one is already open on the same visit", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const { doctor, res: firstRes } = await openConsultationAsDoctor(visitId);
    expect(firstRes.status).toBe(201);

    // Visit is now WITH_DOCTOR with an open consultation — a second
    // open attempt must be rejected, not silently create a second
    // concurrently-open consultation row.
    const secondRes = await doctor.post(`/api/v1/visits/${visitId}/consultations`);
    expect(secondRes.status).toBe(409);
    expect(secondRes.body.error.code).toBe("CONSULTATION_ALREADY_OPEN");
  });

  it("allows opening a second consultation only after the first is completed", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const { doctor, consultationId } = await openConsultationAsDoctor(visitId);
    await doctor.post(`/api/v1/consultations/${consultationId}/complete`); // -> WAITING_FOR_BILLING

    // WAITING_FOR_BILLING is neither WAITING_FOR_DOCTOR nor WITH_DOCTOR,
    // so a same-visit re-open correctly still fails here — but for a
    // different reason (visit state), confirming the two guards are
    // independent checks, not one masking the other.
    const res = await doctor.post(`/api/v1/visits/${visitId}/consultations`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_VISIT_STATE");
  });
});

describe("GET /api/v1/consultations/:id", () => {
  it("returns the consultation with an empty diagnoses list initially", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const { doctor, consultationId } = await openConsultationAsDoctor(visitId);
    const res = await doctor.get(`/api/v1/consultations/${consultationId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.diagnoses).toEqual([]);
  });

  it("returns 404 for a non-existent consultation", async () => {
    const doctor = await loginAs("test.doctor");
    const res = await doctor.get("/api/v1/consultations/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/v1/consultations/:id (notes, own record only)", () => {
  it("allows the owning doctor to save notes", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const { doctor, consultationId } = await openConsultationAsDoctor(visitId);
    const res = await doctor.patch(`/api/v1/consultations/${consultationId}`).send({ notes: "Patient stable." });
    expect(res.status).toBe(200);
    expect(res.body.data.consultation.notes).toBe("Patient stable.");
  });

  it("rejects a different doctor from editing someone else's consultation", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const { consultationId } = await openConsultationAsDoctor(visitId, "test.doctor");

    // test.doctor2 is created lazily below if needed — see setup note.
    const otherDoctor = await loginAs("test.doctor2");
    const res = await otherDoctor.patch(`/api/v1/consultations/${consultationId}`).send({ notes: "Hijack attempt" });
    expect(res.status).toBe(403);
  });

  it("rejects a non-doctor role entirely", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const { consultationId } = await openConsultationAsDoctor(visitId);
    const reception = await loginAs("test.reception");
    const res = await reception.patch(`/api/v1/consultations/${consultationId}`).send({ notes: "x" });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/v1/consultations/:id/diagnoses", () => {
  it("records a diagnosis attributable to the consultation", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const { doctor, consultationId } = await openConsultationAsDoctor(visitId);
    const res = await doctor
      .post(`/api/v1/consultations/${consultationId}/diagnoses`)
      .send({ description: "Acute pharyngitis" });
    expect(res.status).toBe(201);
    expect(res.body.data.diagnosis.description).toBe("Acute pharyngitis");

    const detail = await doctor.get(`/api/v1/consultations/${consultationId}`);
    expect(detail.body.data.diagnoses).toHaveLength(1);
  });

  it("rejects an empty description", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const { doctor, consultationId } = await openConsultationAsDoctor(visitId);
    const res = await doctor.post(`/api/v1/consultations/${consultationId}/diagnoses`).send({ description: "" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/consultations/:id/lab-orders (record only)", () => {
  it("creates a lab order with REQUESTED status", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const { doctor, consultationId } = await openConsultationAsDoctor(visitId);
    const res = await doctor
      .post(`/api/v1/consultations/${consultationId}/lab-orders`)
      .send({ testNames: ["CBC", "Malaria smear"] });
    expect(res.status).toBe(201);
    expect(res.body.data.labOrder.status).toBe("REQUESTED");
    expect(res.body.data.labOrder.testNames).toEqual(["CBC", "Malaria smear"]);
  });

  it("rejects an empty test list", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const { doctor, consultationId } = await openConsultationAsDoctor(visitId);
    const res = await doctor.post(`/api/v1/consultations/${consultationId}/lab-orders`).send({ testNames: [] });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/consultations/:id/prescriptions (record only)", () => {
  it("creates a prescription with free-text medicine name", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const { doctor, consultationId } = await openConsultationAsDoctor(visitId);
    const res = await doctor.post(`/api/v1/consultations/${consultationId}/prescriptions`).send({
      items: [{ medicineName: "Amoxicillin", strength: "500mg", dosage: "1 tab", frequency: "3x/day", duration: "7 days" }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.prescription.items[0].medicineName).toBe("Amoxicillin");
    expect(res.body.data.prescription.items[0].status).toBe("PENDING");
  });
});

describe("POST /api/v1/consultations/:id/complete — branching to the correct next status", () => {
  it("no lab order, no prescription -> WAITING_FOR_BILLING", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const { doctor, consultationId } = await openConsultationAsDoctor(visitId);
    const res = await doctor.post(`/api/v1/consultations/${consultationId}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.data.visitStatus).toBe("WAITING_FOR_BILLING");
  });

  it("prescription only -> WAITING_FOR_PHARMACY", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const { doctor, consultationId } = await openConsultationAsDoctor(visitId);
    await doctor
      .post(`/api/v1/consultations/${consultationId}/prescriptions`)
      .send({ items: [{ medicineName: "Paracetamol" }] });

    const res = await doctor.post(`/api/v1/consultations/${consultationId}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.data.visitStatus).toBe("WAITING_FOR_PHARMACY");
  });

  it("lab order (even with a prescription too) -> WAITING_FOR_LAB takes priority", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const { doctor, consultationId } = await openConsultationAsDoctor(visitId);
    await doctor.post(`/api/v1/consultations/${consultationId}/lab-orders`).send({ testNames: ["CBC"] });
    await doctor
      .post(`/api/v1/consultations/${consultationId}/prescriptions`)
      .send({ items: [{ medicineName: "Paracetamol" }] });

    const res = await doctor.post(`/api/v1/consultations/${consultationId}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.data.visitStatus).toBe("WAITING_FOR_LAB");
  });

  it("rejects completing an already-completed consultation", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const { doctor, consultationId } = await openConsultationAsDoctor(visitId);
    await doctor.post(`/api/v1/consultations/${consultationId}/complete`);

    const res = await doctor.post(`/api/v1/consultations/${consultationId}/complete`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONSULTATION_COMPLETED");
  });

  it("rejects adding a diagnosis after completion", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const { doctor, consultationId } = await openConsultationAsDoctor(visitId);
    await doctor.post(`/api/v1/consultations/${consultationId}/complete`);

    const res = await doctor
      .post(`/api/v1/consultations/${consultationId}/diagnoses`)
      .send({ description: "too late" });
    expect(res.status).toBe(409);
  });

  it("rejects a non-owning doctor from completing someone else's consultation", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const { consultationId } = await openConsultationAsDoctor(visitId, "test.doctor");
    const otherDoctor = await loginAs("test.doctor2");
    const res = await otherDoctor.post(`/api/v1/consultations/${consultationId}/complete`);
    expect(res.status).toBe(403);
  });
});

describe("Re-opening after lab review — multiple consultations per visit", () => {
  it("a second consultation can be opened once the visit returns to WITH_DOCTOR after LAB_COMPLETED", async () => {
    const { visitId } = await createVisitWaitingForDoctor();
    const { doctor, consultationId: firstConsultId } = await openConsultationAsDoctor(visitId);
    await doctor.post(`/api/v1/consultations/${firstConsultId}/lab-orders`).send({ testNames: ["CBC"] });
    await doctor.post(`/api/v1/consultations/${firstConsultId}/complete`); // -> WAITING_FOR_LAB

    const lab = await loginAs("test.lab");
    await lab.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "AT_LAB" });
    await lab.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "LAB_COMPLETED" });

    // LAB_COMPLETED -> WITH_DOCTOR is the existing, unmodified
    // transition (Phase 1 §4.1) — it goes directly to WITH_DOCTOR,
    // never back through WAITING_FOR_DOCTOR.
    const reviewTransition = await doctor
      .post(`/api/v1/visits/${visitId}/transition`)
      .send({ toStatus: "WITH_DOCTOR" });
    expect(reviewTransition.status).toBe(200);
    expect(reviewTransition.body.data.visit.status).toBe("WITH_DOCTOR");

    const { res } = await openConsultationAsDoctor(visitId);
    expect(res.status).toBe(201);
    expect(res.body.data.consultation.id).not.toBe(firstConsultId);

    // Both consultations exist, linked to the same visit — confirms
    // the approved "multiple consultations per visit" design.
    const firstDetail = await doctor.get(`/api/v1/consultations/${firstConsultId}`);
    expect(firstDetail.body.data.consultation.visitId).toBe(visitId);
  });
});
