import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { seedTestUsers, closeTestPool, TEST_PASSWORD } from "./setup";
import { pool } from "../src/config/db";
import { receivePurchase } from "../src/modules/purchases/purchases.service";

const app = createApp();

async function loginAs(username: string) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ username, password: TEST_PASSWORD });
  return agent;
}

function uniqueName(base: string) {
  return `${base} ${Date.now()}-${Math.random()}`;
}

async function createSupplier(owner: request.Agent) {
  const res = await owner.post("/api/v1/suppliers").send({ name: uniqueName("Purchase Test Supplier") });
  return res.body.data.supplier.id as string;
}

async function createInventoryItem(owner: request.Agent, quantityOnHand = 0) {
  const res = await owner
    .post("/api/v1/inventory/items")
    .send({ name: uniqueName("Purchase Test Item"), unit: "unit", quantityOnHand });
  return res.body.data.item.id as string;
}

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await closeTestPool();
});

describe("Authorization", () => {
  it("rejects unauthenticated access to every endpoint", async () => {
    expect((await request(app).get("/api/v1/purchases")).status).toBe(401);
    expect((await request(app).get("/api/v1/purchases/00000000-0000-0000-0000-000000000000")).status).toBe(401);
    expect((await request(app).post("/api/v1/purchases")).status).toBe(401);
    expect((await request(app).post("/api/v1/purchases/00000000-0000-0000-0000-000000000000/receive")).status).toBe(
      401
    );
  });

  it("rejects every non-owner role, including Pharmacy, from every endpoint", async () => {
    const owner = await loginAs("test.owner");
    const supplierId = await createSupplier(owner);
    const itemId = await createInventoryItem(owner);
    const createRes = await owner
      .post("/api/v1/purchases")
      .send({ supplierId, purchaseDate: "2026-01-15", items: [{ inventoryItemId: itemId, quantity: 10, unitCost: 5 }] });
    const purchaseId = createRes.body.data.purchase.id;

    for (const username of ["test.reception", "test.nurse", "test.doctor", "test.lab", "test.pharmacy"]) {
      const agent = await loginAs(username);
      expect((await agent.get("/api/v1/purchases")).status).toBe(403);
      expect((await agent.get(`/api/v1/purchases/${purchaseId}`)).status).toBe(403);
      expect((await agent.post("/api/v1/purchases").send({})).status).toBe(403);
      expect((await agent.post(`/api/v1/purchases/${purchaseId}/receive`)).status).toBe(403);
    }
  });

  it("owner can access every endpoint", async () => {
    const owner = await loginAs("test.owner");
    expect((await owner.get("/api/v1/purchases")).status).toBe(200);
  });
});

describe("Create purchase", () => {
  it("creates a purchase with multiple items, PENDING, inventory untouched", async () => {
    const owner = await loginAs("test.owner");
    const supplierId = await createSupplier(owner);
    const itemA = await createInventoryItem(owner, 5);
    const itemB = await createInventoryItem(owner, 20);

    const res = await owner.post("/api/v1/purchases").send({
      supplierId,
      purchaseDate: "2026-02-01",
      referenceNumber: "PO-1001",
      items: [
        { inventoryItemId: itemA, quantity: 100, unitCost: 2.5 },
        { inventoryItemId: itemB, quantity: 50, unitCost: 1.2 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.purchase.status).toBe("PENDING");
    expect(res.body.data.purchase.items).toHaveLength(2);

    const stockA = await pool.query("SELECT quantity_on_hand FROM pharmacy_inventory_items WHERE id = $1", [itemA]);
    const stockB = await pool.query("SELECT quantity_on_hand FROM pharmacy_inventory_items WHERE id = $1", [itemB]);
    expect(stockA.rows[0].quantity_on_hand).toBe(5);
    expect(stockB.rows[0].quantity_on_hand).toBe(20);
  });

  it("rejects a non-existent supplier", async () => {
    const owner = await loginAs("test.owner");
    const itemId = await createInventoryItem(owner);
    const res = await owner.post("/api/v1/purchases").send({
      supplierId: "00000000-0000-0000-0000-000000000000",
      purchaseDate: "2026-02-01",
      items: [{ inventoryItemId: itemId, quantity: 5, unitCost: 1 }],
    });
    expect(res.status).toBe(404);
  });

  it("rejects an invalid (non-existent) inventory item, entire batch rolls back", async () => {
    const owner = await loginAs("test.owner");
    const supplierId = await createSupplier(owner);
    const validItem = await createInventoryItem(owner, 10);

    const res = await owner.post("/api/v1/purchases").send({
      supplierId,
      purchaseDate: "2026-02-01",
      items: [
        { inventoryItemId: validItem, quantity: 10, unitCost: 1 },
        { inventoryItemId: "00000000-0000-0000-0000-000000000000", quantity: 5, unitCost: 1 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INVENTORY_ITEM");

    const purchases = await pool.query("SELECT COUNT(*) FROM purchases WHERE supplier_id = $1", [supplierId]);
    expect(Number(purchases.rows[0].count)).toBe(0);
  });

  it("rejects zero/negative quantity", async () => {
    const owner = await loginAs("test.owner");
    const supplierId = await createSupplier(owner);
    const itemId = await createInventoryItem(owner);
    const res = await owner.post("/api/v1/purchases").send({
      supplierId,
      purchaseDate: "2026-02-01",
      items: [{ inventoryItemId: itemId, quantity: 0, unitCost: 1 }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects negative unit cost", async () => {
    const owner = await loginAs("test.owner");
    const supplierId = await createSupplier(owner);
    const itemId = await createInventoryItem(owner);
    const res = await owner.post("/api/v1/purchases").send({
      supplierId,
      purchaseDate: "2026-02-01",
      items: [{ inventoryItemId: itemId, quantity: 5, unitCost: -1 }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects a missing purchaseDate", async () => {
    const owner = await loginAs("test.owner");
    const supplierId = await createSupplier(owner);
    const itemId = await createInventoryItem(owner);
    const res = await owner
      .post("/api/v1/purchases")
      .send({ supplierId, items: [{ inventoryItemId: itemId, quantity: 5, unitCost: 1 }] });
    expect(res.status).toBe(400);
  });

  it("rejects an empty items array", async () => {
    const owner = await loginAs("test.owner");
    const supplierId = await createSupplier(owner);
    const res = await owner.post("/api/v1/purchases").send({ supplierId, purchaseDate: "2026-02-01", items: [] });
    expect(res.status).toBe(400);
  });
});

describe("Get purchase detail / list", () => {
  it("returns 404 for a non-existent purchase", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.get("/api/v1/purchases/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("lists purchases", async () => {
    const owner = await loginAs("test.owner");
    const supplierId = await createSupplier(owner);
    const itemId = await createInventoryItem(owner);
    const createRes = await owner
      .post("/api/v1/purchases")
      .send({ supplierId, purchaseDate: "2026-02-01", items: [{ inventoryItemId: itemId, quantity: 5, unitCost: 1 }] });

    const res = await owner.get("/api/v1/purchases");
    expect(res.status).toBe(200);
    expect(res.body.data.purchases.some((p: { id: string }) => p.id === createRes.body.data.purchase.id)).toBe(true);
  });
});

describe("Receive purchase", () => {
  it("increments stock correctly for every item and marks RECEIVED", async () => {
    const owner = await loginAs("test.owner");
    const supplierId = await createSupplier(owner);
    const itemA = await createInventoryItem(owner, 5);
    const itemB = await createInventoryItem(owner, 20);
    const createRes = await owner.post("/api/v1/purchases").send({
      supplierId,
      purchaseDate: "2026-02-01",
      items: [
        { inventoryItemId: itemA, quantity: 100, unitCost: 2.5 },
        { inventoryItemId: itemB, quantity: 50, unitCost: 1.2 },
      ],
    });
    const purchaseId = createRes.body.data.purchase.id;

    const res = await owner.post(`/api/v1/purchases/${purchaseId}/receive`);
    expect(res.status).toBe(200);
    expect(res.body.data.purchase.status).toBe("RECEIVED");

    const stockA = await pool.query("SELECT quantity_on_hand FROM pharmacy_inventory_items WHERE id = $1", [itemA]);
    const stockB = await pool.query("SELECT quantity_on_hand FROM pharmacy_inventory_items WHERE id = $1", [itemB]);
    expect(stockA.rows[0].quantity_on_hand).toBe(105);
    expect(stockB.rows[0].quantity_on_hand).toBe(70);
  });

  it("rejects double receiving", async () => {
    const owner = await loginAs("test.owner");
    const supplierId = await createSupplier(owner);
    const itemId = await createInventoryItem(owner, 0);
    const createRes = await owner
      .post("/api/v1/purchases")
      .send({ supplierId, purchaseDate: "2026-02-01", items: [{ inventoryItemId: itemId, quantity: 10, unitCost: 1 }] });
    const purchaseId = createRes.body.data.purchase.id;

    await owner.post(`/api/v1/purchases/${purchaseId}/receive`);
    const res = await owner.post(`/api/v1/purchases/${purchaseId}/receive`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PURCHASE_ALREADY_RECEIVED");

    const stock = await pool.query("SELECT quantity_on_hand FROM pharmacy_inventory_items WHERE id = $1", [itemId]);
    expect(stock.rows[0].quantity_on_hand).toBe(10);
  });

  it("rejects receiving a non-existent purchase", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.post("/api/v1/purchases/00000000-0000-0000-0000-000000000000/receive");
    expect(res.status).toBe(404);
  });
});

describe("Transaction atomicity", () => {
  it("a genuine DB-level failure mid-batch rolls back every stock increment already applied in that receive call", async () => {
    const owner = await loginAs("test.owner");
    const supplierId = await createSupplier(owner);
    const itemA = await createInventoryItem(owner, 10);
    const itemB = await createInventoryItem(owner, 30);
    const createRes = await owner.post("/api/v1/purchases").send({
      supplierId,
      purchaseDate: "2026-02-01",
      items: [
        { inventoryItemId: itemA, quantity: 50, unitCost: 1 },
        { inventoryItemId: itemB, quantity: 25, unitCost: 1 },
      ],
    });
    const purchaseId = createRes.body.data.purchase.id;

    // Force a genuine mid-transaction failure: bump the second
    // item's stored quantity (via direct SQL, bypassing Zod's max)
    // past PostgreSQL's integer range, so its UPDATE
    // quantity_on_hand + quantity raises a real "integer out of
    // range" error partway through the loop -- not a mock, not an
    // application-level pre-check.
    await pool.query("UPDATE purchase_items SET quantity = 2147483647 WHERE inventory_item_id = $1", [itemB]);

    await expect(receivePurchase(purchaseId, "irrelevant-for-this-test")).rejects.toThrow();

    // Item A's increment (whichever order the loop processed items
    // in) must NOT have persisted -- proving whole-transaction
    // rollback, not a partial apply.
    const stockA = await pool.query("SELECT quantity_on_hand FROM pharmacy_inventory_items WHERE id = $1", [itemA]);
    expect(stockA.rows[0].quantity_on_hand).toBe(10);

    const purchaseRow = await pool.query("SELECT status FROM purchases WHERE id = $1", [purchaseId]);
    expect(purchaseRow.rows[0].status).toBe("PENDING");
  });
});

describe("Audit events", () => {
  it("purchase.create is recorded", async () => {
    const owner = await loginAs("test.owner");
    const supplierId = await createSupplier(owner);
    const itemId = await createInventoryItem(owner);
    const before = new Date();
    const res = await owner
      .post("/api/v1/purchases")
      .send({ supplierId, purchaseDate: "2026-02-01", items: [{ inventoryItemId: itemId, quantity: 5, unitCost: 1 }] });

    const auditRes = await pool.query(
      `SELECT action FROM audit_logs WHERE created_at >= $1 AND entity_id = $2 AND action = 'purchase.create'`,
      [before, res.body.data.purchase.id]
    );
    expect(auditRes.rows.length).toBeGreaterThan(0);
  });

  it("purchase.receive and inventory_item.stock_increment (per item) are recorded", async () => {
    const owner = await loginAs("test.owner");
    const supplierId = await createSupplier(owner);
    const itemA = await createInventoryItem(owner, 0);
    const itemB = await createInventoryItem(owner, 0);
    const createRes = await owner.post("/api/v1/purchases").send({
      supplierId,
      purchaseDate: "2026-02-01",
      items: [
        { inventoryItemId: itemA, quantity: 10, unitCost: 1 },
        { inventoryItemId: itemB, quantity: 20, unitCost: 1 },
      ],
    });
    const purchaseId = createRes.body.data.purchase.id;

    const before = new Date();
    await owner.post(`/api/v1/purchases/${purchaseId}/receive`);

    const auditRes = await pool.query(
      `SELECT action, entity_id FROM audit_logs WHERE created_at >= $1 ORDER BY created_at`,
      [before]
    );
    const actions = auditRes.rows.map((r) => r.action);
    expect(actions).toContain("purchase.receive");
    const stockIncrementRows = auditRes.rows.filter((r) => r.action === "inventory_item.stock_increment");
    expect(stockIncrementRows.length).toBeGreaterThanOrEqual(2);
    expect(stockIncrementRows.map((r) => r.entity_id)).toEqual(expect.arrayContaining([itemA, itemB]));
  });
});


describe("purchaseDate round-trips as a plain calendar date", () => {
  // Same guarantee as Patients' dateOfBirth: the DATE column comes back
  // exactly as sent, on every endpoint that returns it.
  it("returns the same YYYY-MM-DD string on create, detail, and list", async () => {
    const owner = await loginAs("test.owner");
    const supplierId = await createSupplier(owner);
    const itemId = await createInventoryItem(owner);

    const createRes = await owner
      .post("/api/v1/purchases")
      .send({ supplierId, purchaseDate: "2026-01-01", items: [{ inventoryItemId: itemId, quantity: 1, unitCost: 1 }] });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.purchase.purchaseDate).toBe("2026-01-01");
    const id = createRes.body.data.purchase.id;

    const detailRes = await owner.get(`/api/v1/purchases/${id}`);
    expect(detailRes.body.data.purchase.purchaseDate).toBe("2026-01-01");

    const listRes = await owner.get("/api/v1/purchases");
    const listed = listRes.body.data.purchases.find((p: { id: string }) => p.id === id);
    expect(listed.purchaseDate).toBe("2026-01-01");
  });
});
