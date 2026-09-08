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

function uniqueName(base: string) {
  return `${base} ${Date.now()}-${Math.random()}`;
}

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await closeTestPool();
});

describe("POST /api/v1/inventory/items (creation)", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app)
      .post("/api/v1/inventory/items")
      .send({ name: uniqueName("X"), unit: "tablet", quantityOnHand: 10 });
    expect(res.status).toBe(401);
  });

  it("rejects a non-owner role (pharmacy cannot create stock)", async () => {
    const pharmacy = await loginAs("test.pharmacy");
    const res = await pharmacy
      .post("/api/v1/inventory/items")
      .send({ name: uniqueName("X"), unit: "tablet", quantityOnHand: 10 });
    expect(res.status).toBe(403);
  });

  it("owner can create a valid inventory item", async () => {
    const owner = await loginAs("test.owner");
    const name = uniqueName("Paracetamol 500mg");
    const res = await owner.post("/api/v1/inventory/items").send({ name, unit: "tablet", quantityOnHand: 500 });
    expect(res.status).toBe(201);
    expect(res.body.data.item.quantityOnHand).toBe(500);
    expect(res.body.data.item.name).toBe(name);
  });

  it("rejects a negative quantityOnHand", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner
      .post("/api/v1/inventory/items")
      .send({ name: uniqueName("X"), unit: "tablet", quantityOnHand: -5 });
    expect(res.status).toBe(400);
  });

  it("rejects unknown fields (strict schema)", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner
      .post("/api/v1/inventory/items")
      .send({ name: uniqueName("X"), unit: "tablet", quantityOnHand: 5, sku: "ABC" });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate normalized name (exact match)", async () => {
    const owner = await loginAs("test.owner");
    const name = uniqueName("Amoxicillin 250mg");
    await owner.post("/api/v1/inventory/items").send({ name, unit: "capsule", quantityOnHand: 100 });

    const res = await owner.post("/api/v1/inventory/items").send({ name, unit: "capsule", quantityOnHand: 50 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVENTORY_ITEM_ALREADY_EXISTS");
  });

  it("rejects a duplicate normalized name (case/whitespace variant)", async () => {
    const owner = await loginAs("test.owner");
    const base = uniqueName("Ibuprofen 200mg");
    await owner.post("/api/v1/inventory/items").send({ name: base, unit: "tablet", quantityOnHand: 100 });

    const variant = `  ${base.toUpperCase()}  `;
    const res = await owner.post("/api/v1/inventory/items").send({ name: variant, unit: "tablet", quantityOnHand: 20 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVENTORY_ITEM_ALREADY_EXISTS");
  });
});

describe("GET /api/v1/inventory/items (listing)", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/v1/inventory/items");
    expect(res.status).toBe(401);
  });

  it("rejects roles other than owner/pharmacy (e.g. doctor)", async () => {
    const doctor = await loginAs("test.doctor");
    const res = await doctor.get("/api/v1/inventory/items");
    expect(res.status).toBe(403);
  });

  it("rejects reception explicitly", async () => {
    const reception = await loginAs("test.reception");
    const res = await reception.get("/api/v1/inventory/items");
    expect(res.status).toBe(403);
  });

  it("owner can list items and sees minimal fields only", async () => {
    const owner = await loginAs("test.owner");
    const name = uniqueName("Vitamin C");
    await owner.post("/api/v1/inventory/items").send({ name, unit: "tablet", quantityOnHand: 200 });

    const res = await owner.get("/api/v1/inventory/items");
    expect(res.status).toBe(200);
    const item = res.body.data.items.find((i: { name: string }) => i.name === name);
    expect(item).toBeDefined();
    expect(Object.keys(item).sort()).toEqual(["id", "name", "quantityOnHand", "unit"].sort());
  });

  it("pharmacy can also list items", async () => {
    const pharmacy = await loginAs("test.pharmacy");
    const res = await pharmacy.get("/api/v1/inventory/items");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });
});