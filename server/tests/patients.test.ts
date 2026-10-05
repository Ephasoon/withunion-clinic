import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomInt } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app";
import { pool } from "../src/config/db";
import { normalizePhone, phoneNormalizeSql } from "../src/utils/phone";
import { seedTestUsers, closeTestPool, getUserIdByUsername, TEST_PASSWORD } from "./setup";

const app = createApp();

/**
 * Patient phones are unique (normalized) across every patient ever
 * created, and the test database is not cleaned between runs, so tests
 * that send a phone use a fresh random one: "09" + 12 digits. Returns
 * the local form; plus251() gives the same number as "+251 9…".
 */
function uniquePhone(): string {
  const six = () => String(randomInt(1_000_000)).padStart(6, "0");
  return `09${six()}${six()}`;
}
const plus251 = (local: string) => `+251 ${local.slice(1, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;

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
      phone: uniquePhone(),
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
    const phone = uniquePhone();
    await reception.post("/api/v1/patients").send({
      fullName: "Phone Search Target",
      gender: "male",
      approximateAge: 45,
      phone,
    });

    const res = await reception.get("/api/v1/patients").query({ search: phone });
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

    const phone = uniquePhone();
    const res = await reception.patch(`/api/v1/patients/${id}`).send({ phone });
    expect(res.status).toBe(200);
    expect(res.body.data.patient.phone).toBe(phone);
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
      .send({ patientCode: "WU-999999", phone: uniquePhone() });
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

describe("Patient phone uniqueness", () => {
  async function register(fields: Record<string, unknown>) {
    const reception = await loginAs("test.reception");
    const res = await reception
      .post("/api/v1/patients")
      .send({ fullName: `Phone Rule ${Date.now()}-${Math.random()}`, gender: "female", approximateAge: 30, ...fields });
    return { reception, res };
  }

  /** Inserts straight into the table, bypassing the rule — how legacy duplicates in existing data look. */
  async function insertLegacyPatient(fullName: string, phone: string): Promise<string> {
    const createdBy = await getUserIdByUsername("test.reception");
    const result = await pool.query(
      `INSERT INTO patients (patient_code, full_name, gender, approximate_age, phone, created_by)
       VALUES ('WU-' || lpad(nextval('patient_code_seq')::text, 6, '0'), $1, 'male', 40, $2, $3)
       RETURNING id`,
      [fullName, phone, createdBy]
    );
    return result.rows[0].id;
  }

  it("refuses a second patient with the same phone: 409 with the existing patient's id, code and name", async () => {
    const phone = uniquePhone();
    const first = await register({ fullName: "Original Phone Owner", phone });
    expect(first.res.status).toBe(201);
    const existing = first.res.body.data.patient;

    const { res } = await register({ fullName: "Original Phone Owner", phone });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PATIENT_PHONE_ALREADY_EXISTS");
    expect(res.body.error.details).toEqual({
      patientId: existing.id,
      patientCode: existing.patientCode,
      fullName: "Original Phone Owner",
    });
    expect(res.body.error.message).toBe(
      `This phone number already belongs to Original Phone Owner (${existing.patientCode})`
    );
  });

  it("refuses the same number written in a different format", async () => {
    const phone = uniquePhone();
    expect((await register({ phone })).res.status).toBe(201);

    const digits = phone.slice(1);
    for (const variant of [
      plus251(phone),
      `251${digits}`,
      `${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}`,
      `${phone.slice(0, 4)}-${phone.slice(4, 7)}-${phone.slice(7)}`,
      `(${phone.slice(0, 4)}) ${phone.slice(4)}`,
      `+251 ${digits}`,
    ]) {
      const { res } = await register({ phone: variant });
      expect(res.status, variant).toBe(409);
      expect(res.body.error.code).toBe("PATIENT_PHONE_ALREADY_EXISTS");
    }
  });

  it("allows any number of patients with a blank or missing phone", async () => {
    for (const fields of [{}, {}, { phone: "" }, { phone: "" }, { phone: "   " }]) {
      const { res } = await register(fields);
      expect(res.status, JSON.stringify(fields)).toBe(201);
    }
  });

  it("refuses the same phone even when the name is different (names are not checked)", async () => {
    const phone = uniquePhone();
    expect((await register({ fullName: "Abebe Kebede", phone })).res.status).toBe(201);
    const { res } = await register({ fullName: "Completely Different Person", phone });
    expect(res.status).toBe(409);
  });

  it("does not check names: two patients with the same name and different phones are both accepted", async () => {
    const fullName = `Same Name ${Date.now()}`;
    expect((await register({ fullName, phone: uniquePhone() })).res.status).toBe(201);
    expect((await register({ fullName, phone: uniquePhone() })).res.status).toBe(201);
  });

  it("does not check the emergency contact phone against anything", async () => {
    const phone = uniquePhone();
    expect((await register({ phone })).res.status).toBe(201);
    const { res } = await register({ phone: uniquePhone(), emergencyContactPhone: phone });
    expect(res.status).toBe(201);
    const { res: res2 } = await register({ emergencyContactPhone: phone });
    expect(res2.status).toBe(201);
  });

  it("refuses PATCH onto another patient's phone, in any format", async () => {
    const takenPhone = uniquePhone();
    const owner = (await register({ fullName: "Phone Holder", phone: takenPhone })).res.body.data.patient;
    const { reception, res } = await register({ phone: uniquePhone() });
    const id = res.body.data.patient.id;

    for (const phone of [takenPhone, plus251(takenPhone)]) {
      const patchRes = await reception.patch(`/api/v1/patients/${id}`).send({ phone });
      expect(patchRes.status, phone).toBe(409);
      expect(patchRes.body.error.code).toBe("PATIENT_PHONE_ALREADY_EXISTS");
      expect(patchRes.body.error.details).toEqual({
        patientId: owner.id,
        patientCode: owner.patientCode,
        fullName: "Phone Holder",
      });
    }
    // Nothing was written.
    expect((await reception.get(`/api/v1/patients/${id}`)).body.data.patient.phone).toBe(res.body.data.patient.phone);
  });

  it("allows PATCH that keeps the patient's own phone, re-sent as is or re-formatted", async () => {
    const phone = uniquePhone();
    const { reception, res } = await register({ phone });
    const id = res.body.data.patient.id;

    const same = await reception.patch(`/api/v1/patients/${id}`).send({ phone, notes: "kept phone" });
    expect(same.status).toBe(200);
    const reformatted = await reception.patch(`/api/v1/patients/${id}`).send({ phone: plus251(phone) });
    expect(reformatted.status).toBe(200);
    expect(reformatted.body.data.patient.phone).toBe(plus251(phone));
  });

  it('allows PATCH to a free number, and clearing the phone with "" (stored as an empty string)', async () => {
    const { reception, res } = await register({ phone: uniquePhone() });
    const id = res.body.data.patient.id;

    const free = uniquePhone();
    const moved = await reception.patch(`/api/v1/patients/${id}`).send({ phone: free });
    expect(moved.status).toBe(200);
    expect(moved.body.data.patient.phone).toBe(free);

    const cleared = await reception.patch(`/api/v1/patients/${id}`).send({ phone: "" });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.patient.phone).toBe("");

    // The freed number can now be used by someone else.
    expect((await register({ phone: free })).res.status).toBe(201);
  });

  it("an inactive patient's phone still blocks registration and PATCH", async () => {
    const phone = uniquePhone();
    const { reception, res } = await register({ phone });
    const inactiveId = res.body.data.patient.id;
    expect((await reception.patch(`/api/v1/patients/${inactiveId}`).send({ status: "inactive" })).status).toBe(200);

    const second = await register({ phone: plus251(phone) });
    expect(second.res.status).toBe(409);
    expect(second.res.body.error.details.patientId).toBe(inactiveId);

    const other = (await register({ phone: uniquePhone() })).res.body.data.patient.id;
    const patchRes = await reception.patch(`/api/v1/patients/${other}`).send({ phone });
    expect(patchRes.status).toBe(409);
  });

  it("a legacy duplicate can still have its other fields edited, but cannot move onto another patient's number", async () => {
    const shared = uniquePhone();
    const legacyA = await insertLegacyPatient("Legacy Duplicate A", shared);
    await insertLegacyPatient("Legacy Duplicate B", shared);
    const reception = await loginAs("test.reception");

    const notesOnly = await reception.patch(`/api/v1/patients/${legacyA}`).send({ notes: "edited despite duplicate" });
    expect(notesOnly.status).toBe(200);
    // Re-sending its own (shared) number, even re-formatted, is not a change, so it is not checked.
    const withOwnPhone = await reception
      .patch(`/api/v1/patients/${legacyA}`)
      .send({ phone: plus251(shared), address: "Hawassa" });
    expect(withOwnPhone.status).toBe(200);
    const deactivate = await reception.patch(`/api/v1/patients/${legacyA}`).send({ phone: shared, status: "inactive" });
    expect(deactivate.status).toBe(200);

    const thirdPhone = uniquePhone();
    await register({ fullName: "Third Patient", phone: thirdPhone });
    const moveOnto = await reception.patch(`/api/v1/patients/${legacyA}`).send({ phone: thirdPhone });
    expect(moveOnto.status).toBe(409);
    expect(moveOnto.body.error.details.fullName).toBe("Third Patient");

    // POST is always checked: the shared number can't be registered again.
    expect((await register({ phone: shared })).res.status).toBe(409);
  });

  it("the SQL normalization matches normalizePhone() on the unit-test inputs", async () => {
    const inputs = [
      "0935259622",
      "+251935259622",
      "0935 259 622",
      "+251 (0) 935-259-622",
      "0935 259 622",
      "+251　935 259622",
      "0251935259622",
      "00935259622",
      "123456",
    ];
    const result = await pool.query<{ input: string; normalized: string }>(
      `SELECT input, ${phoneNormalizeSql("input")} AS normalized FROM unnest($1::text[]) AS input`,
      [inputs]
    );
    expect(result.rows).toHaveLength(inputs.length);
    for (const row of result.rows) expect(row.normalized, row.input).toBe(normalizePhone(row.input));
  });
});

describe("PATCH /api/v1/patients/:id — status changes and audit actions", () => {
  async function auditActions(patientId: string, since: Date): Promise<string[]> {
    const res = await pool.query(
      `SELECT action FROM audit_logs WHERE entity = 'patients' AND entity_id = $1 AND created_at >= $2 ORDER BY action`,
      [patientId, since]
    );
    return res.rows.map((r) => r.action);
  }

  async function newPatient() {
    const reception = await loginAs("test.reception");
    const res = await reception
      .post("/api/v1/patients")
      .send({ fullName: `Status Audit ${Date.now()}-${Math.random()}`, gender: "male", approximateAge: 41 });
    return { reception, id: res.body.data.patient.id as string };
  }

  it("deactivating records patient.update and patient.deactivate, by the reception user", async () => {
    const { reception, id } = await newPatient();
    const since = new Date();
    const res = await reception.patch(`/api/v1/patients/${id}`).send({ status: "inactive" });
    expect(res.status).toBe(200);
    expect(res.body.data.patient.status).toBe("inactive");
    expect(await auditActions(id, since)).toEqual(["patient.deactivate", "patient.update"]);

    const deactivate = await pool.query(
      `SELECT user_id FROM audit_logs WHERE entity_id = $1 AND action = 'patient.deactivate'`,
      [id]
    );
    expect(deactivate.rows[0].user_id).toBe(await getUserIdByUsername("test.reception"));
  });

  it("reactivating records patient.update and patient.reactivate", async () => {
    const { reception, id } = await newPatient();
    await reception.patch(`/api/v1/patients/${id}`).send({ status: "inactive" });
    const since = new Date();
    const res = await reception.patch(`/api/v1/patients/${id}`).send({ status: "active" });
    expect(res.status).toBe(200);
    expect(await auditActions(id, since)).toEqual(["patient.reactivate", "patient.update"]);
  });

  it("an edit without a status change, or re-sending the current status, records only patient.update", async () => {
    const { reception, id } = await newPatient();
    const since = new Date();
    await reception.patch(`/api/v1/patients/${id}`).send({ notes: "no status change" });
    await reception.patch(`/api/v1/patients/${id}`).send({ status: "active" });
    expect(await auditActions(id, since)).toEqual(["patient.update", "patient.update"]);

    await reception.patch(`/api/v1/patients/${id}`).send({ status: "inactive" });
    const since2 = new Date();
    await reception.patch(`/api/v1/patients/${id}`).send({ status: "inactive", notes: "still inactive" });
    expect(await auditActions(id, since2)).toEqual(["patient.update"]);
  });

  it("a refused PATCH (phone conflict) changes nothing and records nothing", async () => {
    const reception = await loginAs("test.reception");
    const phone = uniquePhone();
    await reception.post("/api/v1/patients").send({ fullName: "Conflict Owner", gender: "male", approximateAge: 30, phone });
    const { id } = await newPatient();
    const since = new Date();
    const res = await reception.patch(`/api/v1/patients/${id}`).send({ phone, status: "inactive" });
    expect(res.status).toBe(409);
    expect((await reception.get(`/api/v1/patients/${id}`)).body.data.patient.status).toBe("active");
    expect(await auditActions(id, since)).toEqual([]);
  });

  it("an inactive patient leaves search but can still be opened by id", async () => {
    const reception = await loginAs("test.reception");
    const fullName = `Inactive Lookup ${Date.now()}`;
    const id = (await reception.post("/api/v1/patients").send({ fullName, gender: "female", approximateAge: 50 })).body
      .data.patient.id;
    await reception.patch(`/api/v1/patients/${id}`).send({ status: "inactive" });

    const search = await reception.get("/api/v1/patients").query({ search: fullName });
    expect(search.body.data.patients.some((p: { id: string }) => p.id === id)).toBe(false);
    const byId = await reception.get(`/api/v1/patients/${id}`);
    expect(byId.status).toBe(200);
    expect(byId.body.data.patient.status).toBe("inactive");
  });
});
