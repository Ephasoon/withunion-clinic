import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { seedTestUsers, closeTestPool, getUserIdByUsername, TEST_PASSWORD } from "./setup";
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
    expect((await request(app).get("/api/v1/price-list")).status).toBe(401);
    expect((await request(app).get("/api/v1/price-list/00000000-0000-0000-0000-000000000000")).status).toBe(401);
    expect((await request(app).post("/api/v1/price-list")).status).toBe(401);
    expect((await request(app).patch("/api/v1/price-list/00000000-0000-0000-0000-000000000000")).status).toBe(401);
  });

  it("rejects every non-owner role from every endpoint", async () => {
    const owner = await loginAs("test.owner");
    const createRes = await owner.post("/api/v1/price-list").send({ name: uniqueName("Auth Test Item"), price: 100 });
    const id = createRes.body.data.item.id;

    for (const username of ["test.reception", "test.nurse", "test.doctor", "test.lab", "test.pharmacy"]) {
      const agent = await loginAs(username);
      expect((await agent.get("/api/v1/price-list")).status).toBe(403);
      expect((await agent.get(`/api/v1/price-list/${id}`)).status).toBe(403);
      expect((await agent.post("/api/v1/price-list").send({ name: "x", price: 1 })).status).toBe(403);
      expect((await agent.patch(`/api/v1/price-list/${id}`).send({ name: "x" })).status).toBe(403);
    }
  });

  it("owner can access every endpoint", async () => {
    const owner = await loginAs("test.owner");
    expect((await owner.get("/api/v1/price-list")).status).toBe(200);
  });
});

describe("Create price list item", () => {
  it("creates an item, active by default, recording the creating owner", async () => {
    const owner = await loginAs("test.owner");
    const ownerId = await getUserIdByUsername("test.owner");
    const name = uniqueName("Consultation Fee");
    const res = await owner.post("/api/v1/price-list").send({ name, price: 250.5 });
    expect(res.status).toBe(201);
    expect(res.body.data.item.name).toBe(name);
    expect(res.body.data.item.price).toBe(250.5);
    expect(res.body.data.item.isActive).toBe(true);
    expect(res.body.data.item.createdBy).toBe(ownerId);
  });

  it("trims the name", async () => {
    const owner = await loginAs("test.owner");
    const name = uniqueName("Trimmed Item");
    const res = await owner.post("/api/v1/price-list").send({ name: `  ${name}  `, price: 10 });
    expect(res.status).toBe(201);
    expect(res.body.data.item.name).toBe(name);
  });

  it("rejects a duplicate name, case- and whitespace-insensitively", async () => {
    const owner = await loginAs("test.owner");
    const name = uniqueName("Duplicate Item");
    const first = await owner.post("/api/v1/price-list").send({ name, price: 10 });
    expect(first.status).toBe(201);

    for (const variant of [name, name.toUpperCase(), name.toLowerCase(), `  ${name}  `]) {
      const res = await owner.post("/api/v1/price-list").send({ name: variant, price: 20 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("PRICE_LIST_ITEM_ALREADY_EXISTS");
    }
  });

  it("accepts the price limits 0 and 10000000", async () => {
    const owner = await loginAs("test.owner");
    const zero = await owner.post("/api/v1/price-list").send({ name: uniqueName("Free Item"), price: 0 });
    expect(zero.status).toBe(201);
    expect(zero.body.data.item.price).toBe(0);
    const max = await owner.post("/api/v1/price-list").send({ name: uniqueName("Max Item"), price: 10_000_000 });
    expect(max.status).toBe(201);
    expect(max.body.data.item.price).toBe(10_000_000);
  });

  it("rejects a negative price", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.post("/api/v1/price-list").send({ name: uniqueName("X"), price: -1 });
    expect(res.status).toBe(400);
  });

  it("rejects a price above 10000000", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.post("/api/v1/price-list").send({ name: uniqueName("X"), price: 10_000_000.01 });
    expect(res.status).toBe(400);
  });

  it("accepts 2 decimal places and rejects more", async () => {
    const owner = await loginAs("test.owner");
    const ok = await owner.post("/api/v1/price-list").send({ name: uniqueName("Two Decimals"), price: 0.29 });
    expect(ok.status).toBe(201);
    expect(ok.body.data.item.price).toBe(0.29);
    const res = await owner.post("/api/v1/price-list").send({ name: uniqueName("X"), price: 12.345 });
    expect(res.status).toBe(400);
    expect(res.body.error.details.price).toBeDefined();
  });

  it("rejects a non-numeric price", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.post("/api/v1/price-list").send({ name: uniqueName("X"), price: "100" });
    expect(res.status).toBe(400);
  });

  it("rejects a missing price", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.post("/api/v1/price-list").send({ name: uniqueName("X") });
    expect(res.status).toBe(400);
  });

  it("rejects an empty or whitespace-only name", async () => {
    const owner = await loginAs("test.owner");
    expect((await owner.post("/api/v1/price-list").send({ name: "", price: 1 })).status).toBe(400);
    expect((await owner.post("/api/v1/price-list").send({ name: "   ", price: 1 })).status).toBe(400);
  });

  it("accepts a 255-character name and rejects 256", async () => {
    const owner = await loginAs("test.owner");
    const base = uniqueName("Long");
    const ok = await owner.post("/api/v1/price-list").send({ name: base.padEnd(255, "x"), price: 1 });
    expect(ok.status).toBe(201);
    const res = await owner.post("/api/v1/price-list").send({ name: base.padEnd(256, "y"), price: 1 });
    expect(res.status).toBe(400);
  });

  it("rejects unknown fields (strict schema)", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.post("/api/v1/price-list").send({ name: uniqueName("X"), price: 1, code: "ABC" });
    expect(res.status).toBe(400);
  });
});

describe("List price list items", () => {
  it("returns every item including inactive, ordered by name ASC", async () => {
    const owner = await loginAs("test.owner");
    const prefix = uniqueName("List Test");
    const b = await owner.post("/api/v1/price-list").send({ name: `${prefix} B`, price: 2 });
    const a = await owner.post("/api/v1/price-list").send({ name: `${prefix} A`, price: 1 });
    await owner.patch(`/api/v1/price-list/${b.body.data.item.id}`).send({ isActive: false });

    const res = await owner.get("/api/v1/price-list");
    expect(res.status).toBe(200);
    const ours = res.body.data.items.filter((item: { name: string }) => item.name.startsWith(prefix));
    expect(ours.map((item: { id: string }) => item.id)).toEqual([a.body.data.item.id, b.body.data.item.id]);
    expect(ours[1].isActive).toBe(false);
  });
});

describe("Get price list item detail", () => {
  it("returns 404 for a non-existent item", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.get("/api/v1/price-list/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed id", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.get("/api/v1/price-list/not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("returns the item detail", async () => {
    const owner = await loginAs("test.owner");
    const name = uniqueName("Detail Test Item");
    const createRes = await owner.post("/api/v1/price-list").send({ name, price: 75 });
    const res = await owner.get(`/api/v1/price-list/${createRes.body.data.item.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.item.name).toBe(name);
    expect(res.body.data.item.price).toBe(75);
  });
});

describe("Update / deactivate / reactivate", () => {
  it("updates the price alone", async () => {
    const owner = await loginAs("test.owner");
    const name = uniqueName("Update Price Test");
    const createRes = await owner.post("/api/v1/price-list").send({ name, price: 100 });
    const id = createRes.body.data.item.id;

    const res = await owner.patch(`/api/v1/price-list/${id}`).send({ price: 120.75 });
    expect(res.status).toBe(200);
    expect(res.body.data.item.price).toBe(120.75);
    expect(res.body.data.item.name).toBe(name);
  });

  it("updates the name alone", async () => {
    const owner = await loginAs("test.owner");
    const createRes = await owner.post("/api/v1/price-list").send({ name: uniqueName("Rename Test"), price: 100 });
    const id = createRes.body.data.item.id;
    const newName = uniqueName("Renamed");

    const res = await owner.patch(`/api/v1/price-list/${id}`).send({ name: newName });
    expect(res.status).toBe(200);
    expect(res.body.data.item.name).toBe(newName);
    expect(res.body.data.item.price).toBe(100);
  });

  it("allows an item to re-case its own name", async () => {
    const owner = await loginAs("test.owner");
    const name = uniqueName("recase test");
    const createRes = await owner.post("/api/v1/price-list").send({ name, price: 1 });
    const id = createRes.body.data.item.id;

    const res = await owner.patch(`/api/v1/price-list/${id}`).send({ name: name.toUpperCase() });
    expect(res.status).toBe(200);
    expect(res.body.data.item.name).toBe(name.toUpperCase());
  });

  it("rejects renaming to another item's name", async () => {
    const owner = await loginAs("test.owner");
    const takenName = uniqueName("Taken Name");
    await owner.post("/api/v1/price-list").send({ name: takenName, price: 1 });
    const createRes = await owner.post("/api/v1/price-list").send({ name: uniqueName("Other"), price: 1 });

    const res = await owner
      .patch(`/api/v1/price-list/${createRes.body.data.item.id}`)
      .send({ name: ` ${takenName.toLowerCase()} ` });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PRICE_LIST_ITEM_ALREADY_EXISTS");
  });

  it("rejects an invalid price on update", async () => {
    const owner = await loginAs("test.owner");
    const createRes = await owner.post("/api/v1/price-list").send({ name: uniqueName("Bad Price Patch"), price: 1 });
    const id = createRes.body.data.item.id;
    expect((await owner.patch(`/api/v1/price-list/${id}`).send({ price: -5 })).status).toBe(400);
    expect((await owner.patch(`/api/v1/price-list/${id}`).send({ price: 1.001 })).status).toBe(400);
  });

  it("rejects an empty patch body", async () => {
    const owner = await loginAs("test.owner");
    const createRes = await owner.post("/api/v1/price-list").send({ name: uniqueName("Empty Patch Test"), price: 1 });
    const id = createRes.body.data.item.id;
    const res = await owner.patch(`/api/v1/price-list/${id}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    // Refine without a path: Zod puts the message in formErrors, which
    // validateBody does not return — same as Suppliers PATCH.
    expect(res.body.error.details).toEqual({});
  });

  it("deactivates an item", async () => {
    const owner = await loginAs("test.owner");
    const createRes = await owner.post("/api/v1/price-list").send({ name: uniqueName("Deactivate Test"), price: 1 });
    const id = createRes.body.data.item.id;

    const res = await owner.patch(`/api/v1/price-list/${id}`).send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.item.isActive).toBe(false);
  });

  it("reactivates a deactivated item", async () => {
    const owner = await loginAs("test.owner");
    const createRes = await owner.post("/api/v1/price-list").send({ name: uniqueName("Reactivate Test"), price: 1 });
    const id = createRes.body.data.item.id;
    await owner.patch(`/api/v1/price-list/${id}`).send({ isActive: false });

    const res = await owner.patch(`/api/v1/price-list/${id}`).send({ isActive: true });
    expect(res.status).toBe(200);
    expect(res.body.data.item.isActive).toBe(true);
  });

  it("returns 404 when updating a non-existent item", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner
      .patch("/api/v1/price-list/00000000-0000-0000-0000-000000000000")
      .send({ name: "X" });
    expect(res.status).toBe(404);
  });
});

describe("Audit events", () => {
  it("price_list_item.create is recorded", async () => {
    const owner = await loginAs("test.owner");
    const before = new Date();
    const res = await owner.post("/api/v1/price-list").send({ name: uniqueName("Audit Create Test"), price: 1 });
    expect(res.status).toBe(201);

    const auditRes = await pool.query(
      `SELECT action FROM audit_logs WHERE created_at >= $1 AND entity_id = $2 AND action = 'price_list_item.create'`,
      [before, res.body.data.item.id]
    );
    expect(auditRes.rows.length).toBeGreaterThan(0);
  });

  it("price_list_item.update is recorded with before/after values", async () => {
    const owner = await loginAs("test.owner");
    const createRes = await owner.post("/api/v1/price-list").send({ name: uniqueName("Audit Update Test"), price: 10 });
    const id = createRes.body.data.item.id;

    const before = new Date();
    const res = await owner.patch(`/api/v1/price-list/${id}`).send({ price: 20 });
    expect(res.status).toBe(200);

    const auditRes = await pool.query(
      `SELECT before_value, after_value FROM audit_logs
       WHERE created_at >= $1 AND entity_id = $2 AND action = 'price_list_item.update'`,
      [before, id]
    );
    expect(auditRes.rows.length).toBe(1);
    expect(auditRes.rows[0].before_value.price).toBe(10);
    expect(auditRes.rows[0].after_value.price).toBe(20);
  });

  it("price_list_item.update and price_list_item.deactivate are both recorded on a deactivating patch", async () => {
    const owner = await loginAs("test.owner");
    const createRes = await owner.post("/api/v1/price-list").send({ name: uniqueName("Audit Deactivate Test"), price: 1 });
    const id = createRes.body.data.item.id;

    const before = new Date();
    const res = await owner.patch(`/api/v1/price-list/${id}`).send({ isActive: false });
    expect(res.status).toBe(200);

    const auditRes = await pool.query(
      `SELECT action FROM audit_logs WHERE created_at >= $1 AND entity_id = $2 ORDER BY created_at`,
      [before, id]
    );
    const actions = auditRes.rows.map((r) => r.action);
    expect(actions).toContain("price_list_item.update");
    expect(actions).toContain("price_list_item.deactivate");
  });
});
