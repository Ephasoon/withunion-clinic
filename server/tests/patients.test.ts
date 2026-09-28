import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { seedTestUsers, closeTestPool, TEST_PASSWORD } from "./setup";

const app = createApp();

async function loginAs(username: string) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ username, password: TEST_PASSWORD });
  return agent;
}

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await closeTestPool();
});

describe("POST /api/v1/patients (registration)", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).post("/api/v1/patients").send({ fullName: "X", gender: "male", approximateAge: 30 });
    expect(res.status).toBe(401);
  });

  it("rejects a non-reception role (e.g. pharmacy) from registering a patient", async () => {
    const agent = await loginAs("test.pharmacy");
    const res = await agent.post("/api/v1/patients").send({ fullName: "X", gender: "male", approximateAge: 30 });
    expect(res.status).toBe(403);
  });

  it("rejects a body missing both dateOfBirth and approximateAge", async () => {
    const agent = await loginAs("test.reception");
    const res = await agent.post("/api/v1/patients").send({ fullName: "No Age Patient", gender: "male" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects unknown fields (strict schema)", async () => {
    const agent = await loginAs("test.reception");
    const res = await agent
      .post("/api/v1/patients")
      .send({ fullName: "Strict Test", gender: "male", approximateAge: 40, notARealField: "x" });
    expect(res.status).toBe(400);
  });

  it("reception can register a new patient and receives a generated WU-###### code", async () => {
    const agent = await loginAs("test.reception");
    const res = await agent.post("/api/v1/patients").send({
      fullName: "Almaz Bekele",
      gender: "female",
      approximateAge: 34,
      phone: "0911234567",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.patient.patientCode).toMatch(/^WU-\d{6}$/);
    expect(res.body.data.patient.fullName).toBe("Almaz Bekele");
    expect(res.body.data.patient.createdBy).toBeTruthy();
  });

  it("assigns sequentially increasing patient codes", async () => {
    const agent = await loginAs("test.reception");
    const res1 = await agent
      .post("/api/v1/patients")
      .send({ fullName: "Seq One", gender: "male", approximateAge: 20 });
    const res2 = await agent
      .post("/api/v1/patients")
      .send({ fullName: "Seq Two", gender: "male", approximateAge: 21 });

    const n1 = parseInt(res1.body.data.patient.patientCode.split("-")[1], 10);
    const n2 = parseInt(res2.body.data.patient.patientCode.split("-")[1], 10);
    expect(n2).toBe(n1 + 1);
  });
});

describe("GET /api/v1/patients (search)", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/v1/patients");
    expect(res.status).toBe(401);
  });

  it("allows a non-reception clinical role (nurse doesn't exist as active test user; use lab/pharmacy) to search — view access for all roles", async () => {
    const agent = await loginAs("test.pharmacy");
    const res = await agent.get("/api/v1/patients");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.patients)).toBe(true);
  });

  it("finds a patient by exact phone number", async () => {
    const reception = await loginAs("test.reception");
    await reception.post("/api/v1/patients").send({
      fullName: "Phone Search Target",
      gender: "male",
      approximateAge: 45,
      phone: "0922334455",
    });

    const res = await reception.get("/api/v1/patients").query({ search: "0922334455" });
    expect(res.status).toBe(200);
    expect(res.body.data.patients.some((p: { fullName: string }) => p.fullName === "Phone Search Target")).toBe(
      true
    );
  });

  it("finds a patient by fuzzy name match without merging/deduping automatically", async () => {
    const reception = await loginAs("test.reception");
    await reception.post("/api/v1/patients").send({ fullName: "Fuzzy Match Case", gender: "female", approximateAge: 29 });

    const res = await reception.get("/api/v1/patients").query({ search: "Fuzzy Match" });
    expect(res.status).toBe(200);
    expect(res.body.data.patients.length).toBeGreaterThan(0);
    // Confirms it's a list of candidates, not a single silently-merged record.
    expect(Array.isArray(res.body.data.patients)).toBe(true);
  });
});

describe("GET /api/v1/patients/:id", () => {
  it("returns 404 for a non-existent (but valid-format) id", async () => {
    const agent = await loginAs("test.reception");
    const res = await agent.get("/api/v1/patients/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed id", async () => {
    const agent = await loginAs("test.reception");
    const res = await agent.get("/api/v1/patients/not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("returns the patient profile for a valid id", async () => {
    const reception = await loginAs("test.reception");
    const createRes = await reception
      .post("/api/v1/patients")
      .send({ fullName: "Profile Fetch Target", gender: "male", approximateAge: 50 });
    const id = createRes.body.data.patient.id;

    const res = await reception.get(`/api/v1/patients/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.patient.fullName).toBe("Profile Fetch Target");
  });
});

describe("PATCH /api/v1/patients/:id", () => {
  it("rejects a non-reception role from editing patient data", async () => {
    const reception = await loginAs("test.reception");
    const createRes = await reception
      .post("/api/v1/patients")
      .send({ fullName: "Edit Guard Target", gender: "female", approximateAge: 22 });
    const id = createRes.body.data.patient.id;

    const pharmacy = await loginAs("test.pharmacy");
    const res = await pharmacy.patch(`/api/v1/patients/${id}`).send({ phone: "0900000000" });
    expect(res.status).toBe(403);
  });

  it("allows reception to update contact fields", async () => {
    const reception = await loginAs("test.reception");
    const createRes = await reception
      .post("/api/v1/patients")
      .send({ fullName: "Edit Allowed Target", gender: "male", approximateAge: 60 });
    const id = createRes.body.data.patient.id;

    const res = await reception.patch(`/api/v1/patients/${id}`).send({ phone: "0933445566" });
    expect(res.status).toBe(200);
    expect(res.body.data.patient.phone).toBe("0933445566");
  });

  it("does not allow patient_code or id to be changed (not part of the schema)", async () => {
    const reception = await loginAs("test.reception");
    const createRes = await reception
      .post("/api/v1/patients")
      .send({ fullName: "Immutable Code Target", gender: "male", approximateAge: 33 });
    const id = createRes.body.data.patient.id;
    const originalCode = createRes.body.data.patient.patientCode;

    const res = await reception
      .patch(`/api/v1/patients/${id}`)
      .send({ patientCode: "WU-999999", phone: "0911112222" });
    // patientCode isn't in the schema at all → rejected as an unknown field.
    expect(res.status).toBe(400);

    const fetchAfter = await reception.get(`/api/v1/patients/${id}`);
    expect(fetchAfter.body.data.patient.patientCode).toBe(originalCode);
  });
});


describe("dateOfBirth round-trips as a plain calendar date", () => {
  // A DATE column must come back exactly as sent ("YYYY-MM-DD"), not as a
  // timestamp shifted by the server's timezone. Exact-string checks, so
  // this holds in any timezone.
  it("returns the same YYYY-MM-DD string on create, read, and update", async () => {
    const reception = await loginAs("test.reception");
    const createRes = await reception
      .post("/api/v1/patients")
      .send({ fullName: `DOB Round Trip ${Date.now()}`, gender: "female", dateOfBirth: "1990-05-14" });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.patient.dateOfBirth).toBe("1990-05-14");
    const id = createRes.body.data.patient.id;

    const readRes = await reception.get(`/api/v1/patients/${id}`);
    expect(readRes.body.data.patient.dateOfBirth).toBe("1990-05-14");

    // A year-boundary date: a timezone shift would land it in the previous year.
    const patchRes = await reception.patch(`/api/v1/patients/${id}`).send({ dateOfBirth: "1985-01-01" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.patient.dateOfBirth).toBe("1985-01-01");

    const rereadRes = await reception.get(`/api/v1/patients/${id}`);
    expect(rereadRes.body.data.patient.dateOfBirth).toBe("1985-01-01");
  });
});


describe("GET /api/v1/patients/:id/visits (visit history)", () => {
  async function registerPatient() {
    const reception = await loginAs("test.reception");
    const res = await reception
      .post("/api/v1/patients")
      .send({ fullName: `History Patient ${Date.now()}-${Math.random()}`, gender: "male", approximateAge: 40 });
    return { reception, patientId: res.body.data.patient.id as string };
  }

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/v1/patients/00000000-0000-0000-0000-000000000000/visits");
    expect(res.status).toBe(401);
  });

  it("returns 400 for a malformed patient id", async () => {
    const reception = await loginAs("test.reception");
    const res = await reception.get("/api/v1/patients/not-a-uuid/visits");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for a well-formed but unknown patient id", async () => {
    const reception = await loginAs("test.reception");
    const res = await reception.get("/api/v1/patients/00000000-0000-0000-0000-000000000000/visits");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.message).toBe("Patient not found");
  });

  it("returns an empty list for a patient with no visits", async () => {
    const { reception, patientId } = await registerPatient();
    const res = await reception.get(`/api/v1/patients/${patientId}/visits`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ visits: [] });
  });

  it("lists every visit newest first, including CANCELLED and COMPLETED ones, to any role", async () => {
    const { reception, patientId } = await registerPatient();

    // Oldest: cancelled.
    const v1 = (await reception.post("/api/v1/visits").send({ patientId })).body.data.visit.id as string;
    await reception.post(`/api/v1/visits/${v1}/transition`).send({ toStatus: "CANCELLED", reason: "Left early" });

    // Middle: completed through the real consultation + billing flow.
    const v2 = (await reception.post("/api/v1/visits").send({ patientId })).body.data.visit.id as string;
    await reception.post(`/api/v1/visits/${v2}/transition`).send({ toStatus: "WAITING_FOR_DOCTOR" });
    const doctor = await loginAs("test.doctor");
    const consultRes = await doctor.post(`/api/v1/visits/${v2}/consultations`);
    await doctor.post(`/api/v1/consultations/${consultRes.body.data.consultation.id}/complete`); // -> WAITING_FOR_BILLING
    const invRes = await reception.post(`/api/v1/billing/visits/${v2}/invoice`);
    const completeRes = await reception.post(`/api/v1/billing/invoices/${invRes.body.data.invoice.id}/complete`);
    expect(completeRes.body.data.visitStatus).toBe("COMPLETED");

    // Newest: still open.
    const v3 = (await reception.post("/api/v1/visits").send({ patientId })).body.data.visit.id as string;

    const lab = await loginAs("test.lab");
    const res = await lab.get(`/api/v1/patients/${patientId}/visits`);
    expect(res.status).toBe(200);
    const visits = res.body.data.visits;
    expect(visits.map((v: { id: string }) => v.id)).toEqual([v3, v2, v1]);
    expect(visits.map((v: { status: string }) => v.status)).toEqual(["REGISTERED", "COMPLETED", "CANCELLED"]);
    expect(visits.every((v: { patientId: string }) => v.patientId === patientId)).toBe(true);
  });
});
