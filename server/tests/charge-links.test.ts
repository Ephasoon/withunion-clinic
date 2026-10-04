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

// The test database is shared and never cleaned, so every name is unique per run.
function uniqueName(base: string) {
  return `${base} ${Date.now()}-${Math.random()}`;
}

async function createPriceListItem(price = 100, isActive = true): Promise<string> {
  const owner = await loginAs("test.owner");
  const res = await owner.post("/api/v1/price-list").send({ name: uniqueName("Charge Link Item"), price });
  const id = res.body.data.item.id as string;
  if (!isActive) await owner.patch(`/api/v1/price-list/${id}`).send({ isActive: false });
  return id;
}

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await closeTestPool();
});

describe("Authorization", () => {
  it("rejects unauthenticated access", async () => {
    expect((await request(app).get("/api/v1/charge-links")).status).toBe(401);
    expect((await request(app).put("/api/v1/charge-links").send({})).status).toBe(401);
  });

  it("rejects nurse, doctor, lab and pharmacy from both routes", async () => {
    const itemId = await createPriceListItem();
    for (const username of ["test.nurse", "test.doctor", "test.lab", "test.pharmacy"]) {
      const agent = await loginAs(username);
      expect((await agent.get("/api/v1/charge-links")).status).toBe(403);
      const name = uniqueName("Forbidden");
      expect((await agent.put("/api/v1/charge-links").send({ name, priceListItemId: itemId })).status).toBe(403);
    }
  });

  it("allows reception and owner on both routes", async () => {
    const itemId = await createPriceListItem();
    for (const username of ["test.reception", "test.owner"]) {
      const agent = await loginAs(username);
      expect((await agent.get("/api/v1/charge-links")).status).toBe(200);
      const res = await agent.put("/api/v1/charge-links").send({ name: uniqueName("Allowed"), priceListItemId: itemId });
      expect(res.status).toBe(201);
    }
  });
});

describe("Save (upsert) a charge link", () => {
  it("creates a link under the normalized name, then lists it", async () => {
    const reception = await loginAs("test.reception");
    const receptionId = await getUserIdByUsername("test.reception");
    const itemId = await createPriceListItem();
    const name = uniqueName("Paracetamol");

    const res = await reception.put("/api/v1/charge-links").send({ name: `  ${name.toUpperCase()}  `, priceListItemId: itemId });
    expect(res.status).toBe(201);
    expect(res.body.data.link.nameKey).toBe(name.toLowerCase());
    expect(res.body.data.link.priceListItemId).toBe(itemId);
    expect(res.body.data.link.createdBy).toBe(receptionId);

    const list = await reception.get("/api/v1/charge-links");
    expect(list.status).toBe(200);
    const found = list.body.data.links.filter((l: { nameKey: string }) => l.nameKey === name.toLowerCase());
    expect(found).toHaveLength(1);
    expect(found[0].priceListItemId).toBe(itemId);
  });

  it("replaces the existing link for the same normalized name instead of adding a second", async () => {
    const reception = await loginAs("test.reception");
    const owner = await loginAs("test.owner");
    const ownerId = await getUserIdByUsername("test.owner");
    const first = await createPriceListItem(10);
    const second = await createPriceListItem(20);
    const name = uniqueName("Full Blood Count");

    const created = await reception.put("/api/v1/charge-links").send({ name, priceListItemId: first });
    expect(created.status).toBe(201);

    const replaced = await owner
      .put("/api/v1/charge-links")
      .send({ name: name.toLowerCase().replace(/ /g, "   "), priceListItemId: second });
    expect(replaced.status).toBe(200);
    expect(replaced.body.data.link.id).toBe(created.body.data.link.id);
    expect(replaced.body.data.link.priceListItemId).toBe(second);
    expect(replaced.body.data.link.createdBy).toBe(ownerId);

    const rows = await pool.query(`SELECT price_list_item_id FROM charge_name_links WHERE name_key = $1`, [
      name.toLowerCase(),
    ]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].price_list_item_id).toBe(second);
  });

  it("rejects an unknown price list item with 404", async () => {
    const reception = await loginAs("test.reception");
    const res = await reception
      .put("/api/v1/charge-links")
      .send({ name: uniqueName("Unknown"), priceListItemId: "00000000-0000-4000-8000-000000000000" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects an inactive price list item with 409 and leaves an existing link untouched", async () => {
    const reception = await loginAs("test.reception");
    const active = await createPriceListItem();
    const inactive = await createPriceListItem(100, false);
    const name = uniqueName("Amoxicillin");
    await reception.put("/api/v1/charge-links").send({ name, priceListItemId: active });

    const res = await reception.put("/api/v1/charge-links").send({ name, priceListItemId: inactive });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PRICE_LIST_ITEM_INACTIVE");

    const rows = await pool.query(`SELECT price_list_item_id FROM charge_name_links WHERE name_key = $1`, [
      name.toLowerCase(),
    ]);
    expect(rows.rows[0].price_list_item_id).toBe(active);
  });
});

describe("Validation", () => {
  it("requires a name of 1–255 characters after trimming", async () => {
    const reception = await loginAs("test.reception");
    const itemId = await createPriceListItem();
    for (const name of ["", "    ", "x".repeat(256)]) {
      const res = await reception.put("/api/v1/charge-links").send({ name, priceListItemId: itemId });
      expect(res.status, JSON.stringify(name.slice(0, 5))).toBe(400);
      expect(res.body.error.details.name).toBeDefined();
    }
    const unique = `${Date.now()}${Math.random()}`.replace(".", "");
    const longest = `  ${unique}${"y".repeat(255 - unique.length)}  `;
    expect((await reception.put("/api/v1/charge-links").send({ name: longest, priceListItemId: itemId })).status).toBe(201);
  });

  it("requires a uuid priceListItemId", async () => {
    const reception = await loginAs("test.reception");
    for (const priceListItemId of [undefined, "not-a-uuid", 123]) {
      const res = await reception.put("/api/v1/charge-links").send({ name: uniqueName("X"), priceListItemId });
      expect(res.status).toBe(400);
      expect(res.body.error.details.priceListItemId).toBeDefined();
    }
  });

  it("rejects unknown fields", async () => {
    const reception = await loginAs("test.reception");
    const itemId = await createPriceListItem();
    const res = await reception
      .put("/api/v1/charge-links")
      .send({ name: uniqueName("X"), priceListItemId: itemId, nameKey: "sneaky" });
    expect(res.status).toBe(400);
  });
});

describe("Audit", () => {
  it("records charge_link.save with before null on create, and before/after on replace", async () => {
    const reception = await loginAs("test.reception");
    const first = await createPriceListItem();
    const second = await createPriceListItem();
    const name = uniqueName("Malaria RDT");

    const before = new Date();
    const created = await reception.put("/api/v1/charge-links").send({ name, priceListItemId: first });
    const linkId = created.body.data.link.id;
    await reception.put("/api/v1/charge-links").send({ name, priceListItemId: second });

    const auditRes = await pool.query(
      `SELECT before_value, after_value FROM audit_logs
       WHERE created_at >= $1 AND entity_id = $2 AND action = 'charge_link.save' ORDER BY created_at ASC`,
      [before, linkId]
    );
    expect(auditRes.rows).toHaveLength(2);
    expect(auditRes.rows[0].before_value).toBeNull();
    expect(auditRes.rows[0].after_value.priceListItemId).toBe(first);
    expect(auditRes.rows[1].before_value.priceListItemId).toBe(first);
    expect(auditRes.rows[1].after_value.priceListItemId).toBe(second);
  });

  it("records nothing for a rejected save", async () => {
    const reception = await loginAs("test.reception");
    const inactive = await createPriceListItem(100, false);
    const before = new Date();
    await reception.put("/api/v1/charge-links").send({ name: uniqueName("Rejected"), priceListItemId: inactive });
    const auditRes = await pool.query(
      `SELECT 1 FROM audit_logs WHERE created_at >= $1 AND action = 'charge_link.save' AND after_value->>'priceListItemId' = $2`,
      [before, inactive]
    );
    expect(auditRes.rows).toHaveLength(0);
  });
});
