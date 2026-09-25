import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { seedTestUsers, closeTestPool, TEST_PASSWORD } from "./setup";
import { pool } from "../src/config/db";

const app = createApp();

async function loginAs(username: string) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ username, password: TEST_PASSWORD });
  return agent;
}

function uniqueName(base: string) {
  return `${base} ${Date.now()}-${Math.random()}`;
}

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await closeTestPool();
});

describe("Authorization", () => {
  it("rejects unauthenticated access to every endpoint", async () => {
    expect((await request(app).get("/api/v1/suppliers")).status).toBe(401);
    expect((await request(app).get("/api/v1/suppliers/00000000-0000-0000-0000-000000000000")).status).toBe(401);
    expect((await request(app).post("/api/v1/suppliers")).status).toBe(401);
    expect((await request(app).patch("/api/v1/suppliers/00000000-0000-0000-0000-000000000000")).status).toBe(401);
  });

  it("rejects every non-owner role from every endpoint", async () => {
    const owner = await loginAs("test.owner");
    const createRes = await owner.post("/api/v1/suppliers").send({ name: uniqueName("Auth Test Supplier") });
    const id = createRes.body.data.supplier.id;

    for (const username of ["test.reception", "test.nurse", "test.doctor", "test.lab", "test.pharmacy"]) {
      const agent = await loginAs(username);
      expect((await agent.get("/api/v1/suppliers")).status).toBe(403);
      expect((await agent.get(`/api/v1/suppliers/${id}`)).status).toBe(403);
      expect((await agent.post("/api/v1/suppliers").send({ name: "x" })).status).toBe(403);
      expect((await agent.patch(`/api/v1/suppliers/${id}`).send({ name: "x" })).status).toBe(403);
    }
  });

  it("owner can access every endpoint", async () => {
    const owner = await loginAs("test.owner");
    expect((await owner.get("/api/v1/suppliers")).status).toBe(200);
  });
});

describe("Create supplier", () => {
  it("creates a supplier with all fields", async () => {
    const owner = await loginAs("test.owner");
    const name = uniqueName("Full Supplier");
    const res = await owner.post("/api/v1/suppliers").send({
      name,
      contactPerson: "Jane Doe",
      phone: "0911223344",
      email: "jane@example.com",
      address: "Hawassa, Ethiopia",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.supplier.name).toBe(name);
    expect(res.body.data.supplier.contactPerson).toBe("Jane Doe");
    expect(res.body.data.supplier.isActive).toBe(true);
  });

  it("creates a supplier with only the required name field", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.post("/api/v1/suppliers").send({ name: uniqueName("Minimal Supplier") });
    expect(res.status).toBe(201);
    expect(res.body.data.supplier.contactPerson).toBeNull();
  });

  it("allows two suppliers to share the same name (no uniqueness constraint)", async () => {
    const owner = await loginAs("test.owner");
    const name = uniqueName("Duplicate Name Supplier");
    const first = await owner.post("/api/v1/suppliers").send({ name });
    const second = await owner.post("/api/v1/suppliers").send({ name });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.supplier.id).not.toBe(second.body.data.supplier.id);
  });

  it("rejects an empty name", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.post("/api/v1/suppliers").send({ name: "" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid email", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.post("/api/v1/suppliers").send({ name: uniqueName("X"), email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("rejects unknown fields (strict schema)", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.post("/api/v1/suppliers").send({ name: uniqueName("X"), sku: "ABC" });
    expect(res.status).toBe(400);
  });
});

describe("Get supplier detail", () => {
  it("returns 404 for a non-existent supplier", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.get("/api/v1/suppliers/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed id", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.get("/api/v1/suppliers/not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("returns the supplier detail", async () => {
    const owner = await loginAs("test.owner");
    const name = uniqueName("Detail Test Supplier");
    const createRes = await owner.post("/api/v1/suppliers").send({ name });
    const res = await owner.get(`/api/v1/suppliers/${createRes.body.data.supplier.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.supplier.name).toBe(name);
  });
});

describe("Update / deactivate / reactivate", () => {
  it("updates ordinary fields", async () => {
    const owner = await loginAs("test.owner");
    const createRes = await owner.post("/api/v1/suppliers").send({ name: uniqueName("Update Test") });
    const id = createRes.body.data.supplier.id;

    const res = await owner.patch(`/api/v1/suppliers/${id}`).send({ phone: "0900000000" });
    expect(res.status).toBe(200);
    expect(res.body.data.supplier.phone).toBe("0900000000");
  });

  it("rejects an empty patch body", async () => {
    const owner = await loginAs("test.owner");
    const createRes = await owner.post("/api/v1/suppliers").send({ name: uniqueName("Empty Patch Test") });
    const id = createRes.body.data.supplier.id;
    const res = await owner.patch(`/api/v1/suppliers/${id}`).send({});
    expect(res.status).toBe(400);
  });

  it("deactivates a supplier", async () => {
    const owner = await loginAs("test.owner");
    const createRes = await owner.post("/api/v1/suppliers").send({ name: uniqueName("Deactivate Test") });
    const id = createRes.body.data.supplier.id;

    const res = await owner.patch(`/api/v1/suppliers/${id}`).send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.supplier.isActive).toBe(false);
  });

  it("reactivates a deactivated supplier", async () => {
    const owner = await loginAs("test.owner");
    const createRes = await owner.post("/api/v1/suppliers").send({ name: uniqueName("Reactivate Test") });
    const id = createRes.body.data.supplier.id;
    await owner.patch(`/api/v1/suppliers/${id}`).send({ isActive: false });

    const res = await owner.patch(`/api/v1/suppliers/${id}`).send({ isActive: true });
    expect(res.status).toBe(200);
    expect(res.body.data.supplier.isActive).toBe(true);
  });

  it("returns 404 when updating a non-existent supplier", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner
      .patch("/api/v1/suppliers/00000000-0000-0000-0000-000000000000")
      .send({ name: "X" });
    expect(res.status).toBe(404);
  });
});

describe("Audit events", () => {
  it("supplier.create is recorded", async () => {
    const owner = await loginAs("test.owner");
    const before = new Date();
    const res = await owner.post("/api/v1/suppliers").send({ name: uniqueName("Audit Create Test") });
    expect(res.status).toBe(201);

    const auditRes = await pool.query(
      `SELECT action FROM audit_logs WHERE created_at >= $1 AND entity_id = $2 AND action = 'supplier.create'`,
      [before, res.body.data.supplier.id]
    );
    expect(auditRes.rows.length).toBeGreaterThan(0);
  });

  it("supplier.update and supplier.deactivate are both recorded on a deactivating patch", async () => {
    const owner = await loginAs("test.owner");
    const createRes = await owner.post("/api/v1/suppliers").send({ name: uniqueName("Audit Deactivate Test") });
    const id = createRes.body.data.supplier.id;

    const before = new Date();
    const res = await owner.patch(`/api/v1/suppliers/${id}`).send({ isActive: false });
    expect(res.status).toBe(200);

    const auditRes = await pool.query(
      `SELECT action FROM audit_logs WHERE created_at >= $1 AND entity_id = $2 ORDER BY created_at`,
      [before, id]
    );
    const actions = auditRes.rows.map((r) => r.action);
    expect(actions).toContain("supplier.update");
    expect(actions).toContain("supplier.deactivate");
  });
});
