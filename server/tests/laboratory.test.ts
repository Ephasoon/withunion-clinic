import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { seedTestUsers, closeTestPool, createTestPatient, getUserIdByUsername, TEST_PASSWORD } from "./setup";
import { pool } from "../src/config/db";
import { enterResults } from "../src/modules/laboratory/laboratory.service";

const app = createApp();

async function loginAs(username: string) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ username, password: TEST_PASSWORD });
  return agent;
}

/**
 * Builds a visit all the way through Nursing and Consultation to a
 * lab order sitting at WAITING_FOR_LAB, exactly the handoff Lab
 * inherits from Consultation — reusing the real modules end to end
 * rather than inserting rows directly.
 */
async function createOrderWaitingForLab(testNames: string[] = ["CBC", "Malaria smear"]) {
  const reception = await loginAs("test.reception");
  const patient = await createTestPatient(`Lab Test Patient ${Date.now()}-${Math.random()}`);
  const visitRes = await reception.post("/api/v1/visits").send({ patientId: patient.id });
  const visitId = visitRes.body.data.visit.id as string;

  await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_NURSE" });
  const nurse = await loginAs("test.nurse");
  await nurse.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_NURSE" });
  await nurse.post(`/api/v1/visits/${visitId}/nursing-assessment`).send({ chiefComplaint: "Fever" });

  const doctor = await loginAs("test.doctor");
  const consultRes = await doctor.post(`/api/v1/visits/${visitId}/consultations`);
  const consultationId = consultRes.body.data.consultation.id as string;
  const labOrderRes = await doctor
    .post(`/api/v1/consultations/${consultationId}/lab-orders`)
    .send({ testNames });
  const orderId = labOrderRes.body.data.labOrder.id as string;
  await doctor.post(`/api/v1/consultations/${consultationId}/complete`); // -> WAITING_FOR_LAB

  return { reception, doctor, visitId, consultationId, orderId };
}

async function startLabAsTech(orderId: string) {
  const lab = await loginAs("test.lab");
  const res = await lab.post(`/api/v1/laboratory/orders/${orderId}/start`);
  return { lab, res };
}

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await closeTestPool();
});

describe("Retrieval", () => {
  it("LAB_TECH can retrieve pending/current laboratory orders", async () => {
    const { orderId } = await createOrderWaitingForLab();
    const lab = await loginAs("test.lab");
    const res = await lab.get("/api/v1/laboratory/orders");
    expect(res.status).toBe(200);
    expect(res.body.data.orders.some((o: { id: string }) => o.id === orderId)).toBe(true);
  });

  it("individual order can be retrieved with requested test items", async () => {
    const { orderId } = await createOrderWaitingForLab(["CBC", "Urinalysis"]);
    const lab = await loginAs("test.lab");
    const res = await lab.get(`/api/v1/laboratory/orders/${orderId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.order.items.map((i: { testName: string }) => i.testName).sort()).toEqual([
      "CBC",
      "Urinalysis",
    ]);
    expect(res.body.data.order.items.every((i: { result: unknown }) => i.result === null)).toBe(true);
  });

  it("returns the project's normal 404 for a non-existent order", async () => {
    const lab = await loginAs("test.lab");
    const res = await lab.get("/api/v1/laboratory/orders/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("existing results are returned once entered", async () => {
    const { orderId } = await createOrderWaitingForLab(["CBC"]);
    await startLabAsTech(orderId);
    const lab = await loginAs("test.lab");
    const detail = await lab.get(`/api/v1/laboratory/orders/${orderId}`);
    const itemId = detail.body.data.order.items[0].id;
    await lab.post(`/api/v1/laboratory/orders/${orderId}/results`).send({ results: [{ itemId, result: "13.5 g/dL" }] });

    const doctor = await loginAs("test.doctor");
    const res = await doctor.get(`/api/v1/laboratory/orders/${orderId}`);
    expect(res.body.data.order.items[0].result).toBe("13.5 g/dL");
  });

  it("doctor can retrieve laboratory results (GET order detail is open to any authenticated role)", async () => {
    const { orderId, doctor } = await createOrderWaitingForLab();
    const res = await doctor.get(`/api/v1/laboratory/orders/${orderId}`);
    expect(res.status).toBe(200);
  });
});

describe("Authorization", () => {
  it("RECEPTION cannot start laboratory work", async () => {
    const { orderId, reception } = await createOrderWaitingForLab();
    const res = await reception.post(`/api/v1/laboratory/orders/${orderId}/start`);
    expect(res.status).toBe(403);
  });

  it("NURSE cannot enter laboratory results", async () => {
    const { orderId } = await createOrderWaitingForLab(["CBC"]);
    await startLabAsTech(orderId);
    const lab = await loginAs("test.lab");
    const detail = await lab.get(`/api/v1/laboratory/orders/${orderId}`);
    const itemId = detail.body.data.order.items[0].id;

    const nurse = await loginAs("test.nurse");
    const res = await nurse
      .post(`/api/v1/laboratory/orders/${orderId}/results`)
      .send({ results: [{ itemId, result: "Negative" }] });
    expect(res.status).toBe(403);
  });

  it("DOCTOR cannot fulfill laboratory work (start)", async () => {
    const { orderId, doctor } = await createOrderWaitingForLab();
    const res = await doctor.post(`/api/v1/laboratory/orders/${orderId}/start`);
    expect(res.status).toBe(403);
  });

  it("PHARMACY cannot complete laboratory work", async () => {
    const { orderId } = await createOrderWaitingForLab(["CBC"]);
    await startLabAsTech(orderId);
    const pharmacy = await loginAs("test.pharmacy");
    const res = await pharmacy.post(`/api/v1/laboratory/orders/${orderId}/complete`);
    expect(res.status).toBe(403);
  });

  it("LAB_TECH can perform every permitted action end to end", async () => {
    const { orderId } = await createOrderWaitingForLab(["CBC"]);
    const { lab, res: startRes } = await startLabAsTech(orderId);
    expect(startRes.status).toBe(200);

    const detail = await lab.get(`/api/v1/laboratory/orders/${orderId}`);
    const itemId = detail.body.data.order.items[0].id;
    const resultRes = await lab
      .post(`/api/v1/laboratory/orders/${orderId}/results`)
      .send({ results: [{ itemId, result: "13.5 g/dL" }] });
    expect(resultRes.status).toBe(200);

    const completeRes = await lab.post(`/api/v1/laboratory/orders/${orderId}/complete`);
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.order.visitStatus).toBe("LAB_COMPLETED");
  });
});

describe("Start", () => {
  it("valid WAITING_FOR_LAB -> AT_LAB", async () => {
    const { orderId } = await createOrderWaitingForLab();
    const { res } = await startLabAsTech(orderId);
    expect(res.status).toBe(200);
    expect(res.body.data.order.visitStatus).toBe("AT_LAB");
  });

  it("invalid start from another queue state is rejected", async () => {
    const { orderId } = await createOrderWaitingForLab();
    await startLabAsTech(orderId); // now AT_LAB
    const { res } = await startLabAsTech(orderId); // second start attempt
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_VISIT_STATE");
  });
});

describe("Results", () => {
  it("a valid single result can be entered", async () => {
    const { orderId } = await createOrderWaitingForLab(["CBC"]);
    await startLabAsTech(orderId);
    const lab = await loginAs("test.lab");
    const detail = await lab.get(`/api/v1/laboratory/orders/${orderId}`);
    const itemId = detail.body.data.order.items[0].id;

    const res = await lab
      .post(`/api/v1/laboratory/orders/${orderId}/results`)
      .send({ results: [{ itemId, result: "13.5 g/dL" }] });
    expect(res.status).toBe(200);
    expect(res.body.data.order.items[0].result).toBe("13.5 g/dL");
  });

  it("multiple results can be entered in one request", async () => {
    const { orderId } = await createOrderWaitingForLab(["CBC", "Malaria smear"]);
    await startLabAsTech(orderId);
    const lab = await loginAs("test.lab");
    const detail = await lab.get(`/api/v1/laboratory/orders/${orderId}`);
    const items = detail.body.data.order.items;

    const res = await lab.post(`/api/v1/laboratory/orders/${orderId}/results`).send({
      results: [
        { itemId: items[0].id, result: "13.5 g/dL" },
        { itemId: items[1].id, result: "Negative" },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.order.items.every((i: { result: unknown }) => i.result !== null)).toBe(true);
  });

  it("an existing result can be updated while AT_LAB", async () => {
    const { orderId } = await createOrderWaitingForLab(["CBC"]);
    await startLabAsTech(orderId);
    const lab = await loginAs("test.lab");
    const detail = await lab.get(`/api/v1/laboratory/orders/${orderId}`);
    const itemId = detail.body.data.order.items[0].id;

    await lab.post(`/api/v1/laboratory/orders/${orderId}/results`).send({ results: [{ itemId, result: "First" }] });
    const res = await lab
      .post(`/api/v1/laboratory/orders/${orderId}/results`)
      .send({ results: [{ itemId, result: "Corrected" }] });
    expect(res.status).toBe(200);
    expect(res.body.data.order.items[0].result).toBe("Corrected");
  });

  it("an empty result is rejected", async () => {
    const { orderId } = await createOrderWaitingForLab(["CBC"]);
    await startLabAsTech(orderId);
    const lab = await loginAs("test.lab");
    const detail = await lab.get(`/api/v1/laboratory/orders/${orderId}`);
    const itemId = detail.body.data.order.items[0].id;

    const res = await lab.post(`/api/v1/laboratory/orders/${orderId}/results`).send({ results: [{ itemId, result: "" }] });
    expect(res.status).toBe(400);
  });

  it("a whitespace-only result is rejected", async () => {
    const { orderId } = await createOrderWaitingForLab(["CBC"]);
    await startLabAsTech(orderId);
    const lab = await loginAs("test.lab");
    const detail = await lab.get(`/api/v1/laboratory/orders/${orderId}`);
    const itemId = detail.body.data.order.items[0].id;

    const res = await lab
      .post(`/api/v1/laboratory/orders/${orderId}/results`)
      .send({ results: [{ itemId, result: "   " }] });
    expect(res.status).toBe(400);
  });

  it("a foreign itemId (belonging to a different order) is rejected", async () => {
    const { orderId: orderA } = await createOrderWaitingForLab(["CBC"]);
    const { orderId: orderB } = await createOrderWaitingForLab(["Urinalysis"]);
    await startLabAsTech(orderA);
    await startLabAsTech(orderB);
    const lab = await loginAs("test.lab");
    const detailB = await lab.get(`/api/v1/laboratory/orders/${orderB}`);
    const foreignItemId = detailB.body.data.order.items[0].id;

    const res = await lab
      .post(`/api/v1/laboratory/orders/${orderA}/results`)
      .send({ results: [{ itemId: foreignItemId, result: "Negative" }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("ITEM_NOT_IN_ORDER");
  });

  it("result entry outside AT_LAB is rejected (still WAITING_FOR_LAB)", async () => {
    const { orderId } = await createOrderWaitingForLab(["CBC"]);
    const lab = await loginAs("test.lab");
    const detail = await lab.get(`/api/v1/laboratory/orders/${orderId}`);
    const itemId = detail.body.data.order.items[0].id;

    const res = await lab
      .post(`/api/v1/laboratory/orders/${orderId}/results`)
      .send({ results: [{ itemId, result: "13.5 g/dL" }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_VISIT_STATE");
  });

  it("completed laboratory work cannot be modified", async () => {
    const { orderId } = await createOrderWaitingForLab(["CBC"]);
    await startLabAsTech(orderId);
    const lab = await loginAs("test.lab");
    const detail = await lab.get(`/api/v1/laboratory/orders/${orderId}`);
    const itemId = detail.body.data.order.items[0].id;
    await lab.post(`/api/v1/laboratory/orders/${orderId}/results`).send({ results: [{ itemId, result: "13.5 g/dL" }] });
    await lab.post(`/api/v1/laboratory/orders/${orderId}/complete`);

    const res = await lab
      .post(`/api/v1/laboratory/orders/${orderId}/results`)
      .send({ results: [{ itemId, result: "Changed after completion" }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_VISIT_STATE");
  });
});

describe("Completion", () => {
  it("an incomplete laboratory order cannot be completed", async () => {
    const { orderId } = await createOrderWaitingForLab(["CBC", "Malaria smear"]);
    await startLabAsTech(orderId);
    const lab = await loginAs("test.lab");
    const detail = await lab.get(`/api/v1/laboratory/orders/${orderId}`);
    const items = detail.body.data.order.items;
    // Only enter a result for one of the two requested tests.
    await lab
      .post(`/api/v1/laboratory/orders/${orderId}/results`)
      .send({ results: [{ itemId: items[0].id, result: "13.5 g/dL" }] });

    const res = await lab.post(`/api/v1/laboratory/orders/${orderId}/complete`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INCOMPLETE_RESULTS");
  });

  it("a complete laboratory order can be completed, moving the visit to LAB_COMPLETED", async () => {
    const { orderId } = await createOrderWaitingForLab(["CBC", "Malaria smear"]);
    await startLabAsTech(orderId);
    const lab = await loginAs("test.lab");
    const detail = await lab.get(`/api/v1/laboratory/orders/${orderId}`);
    const items = detail.body.data.order.items;
    await lab.post(`/api/v1/laboratory/orders/${orderId}/results`).send({
      results: [
        { itemId: items[0].id, result: "13.5 g/dL" },
        { itemId: items[1].id, result: "Negative" },
      ],
    });

    const res = await lab.post(`/api/v1/laboratory/orders/${orderId}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.data.order.visitStatus).toBe("LAB_COMPLETED");
  });

  it("produces the expected queue event through the existing transition mechanism", async () => {
    const { orderId, visitId, doctor } = await createOrderWaitingForLab(["CBC"]);
    await startLabAsTech(orderId);
    const lab = await loginAs("test.lab");
    const detail = await lab.get(`/api/v1/laboratory/orders/${orderId}`);
    const itemId = detail.body.data.order.items[0].id;
    await lab.post(`/api/v1/laboratory/orders/${orderId}/results`).send({ results: [{ itemId, result: "13.5 g/dL" }] });
    await lab.post(`/api/v1/laboratory/orders/${orderId}/complete`);

    const visitDetail = await doctor.get(`/api/v1/visits/${visitId}`);
    const lastEvent = visitDetail.body.data.history[visitDetail.body.data.history.length - 1];
    expect(lastEvent.fromStatus).toBe("AT_LAB");
    expect(lastEvent.toStatus).toBe("LAB_COMPLETED");
  });
});

describe("Transaction atomicity — enterResults rolls back completely on a mid-batch failure", () => {
  it("a real foreign-key violation (result_entered_by referencing a non-existent user) rolls back every item in the batch, not just the failing one", async () => {
    const { orderId } = await createOrderWaitingForLab(["CBC", "Malaria smear"]);
    await startLabAsTech(orderId);
    const lab = await loginAs("test.lab");
    const detail = await lab.get(`/api/v1/laboratory/orders/${orderId}`);
    const items = detail.body.data.order.items;

    const bogusUserId = "00000000-0000-0000-0000-000000000000"; // well-formed UUID, no such user

    // Calling the service directly (bypassing the route's session-derived
    // real user id) to force a genuine Postgres foreign-key violation on
    // result_entered_by — not a Zod-catchable input error, not a weakened
    // schema, the real FK constraint added by this phase's migration.
    await expect(
      enterResults(orderId, bogusUserId, {
        results: [
          { itemId: items[0].id, result: "13.5 g/dL" },
          { itemId: items[1].id, result: "Negative" },
        ],
      })
    ).rejects.toThrow();

    // Prove nothing from the failed batch survived — both items still
    // have no result, confirming the whole transaction rolled back
    // rather than partially committing.
    const rawResult = await pool.query(
      `SELECT result FROM laboratory_order_items WHERE order_id = $1 ORDER BY test_name`,
      [orderId]
    );
    expect(rawResult.rows.every((r) => r.result === null)).toBe(true);
  });

  it("confirms the happy path still fully persists both items when no failure occurs", async () => {
    const { orderId } = await createOrderWaitingForLab(["CBC", "Malaria smear"]);
    await startLabAsTech(orderId);
    const realLabTechId = await getUserIdByUsername("test.lab");
    const lab = await loginAs("test.lab");
    const detail = await lab.get(`/api/v1/laboratory/orders/${orderId}`);
    const items = detail.body.data.order.items;

    const outcome = await enterResults(orderId, realLabTechId, {
      results: [
        { itemId: items[0].id, result: "13.5 g/dL" },
        { itemId: items[1].id, result: "Negative" },
      ],
    });
    expect(outcome.order.items.every((i) => i.result !== null)).toBe(true);
  });
});