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
