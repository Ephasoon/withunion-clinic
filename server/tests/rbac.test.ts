import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { seedTestUsers, closeTestPool, TEST_PASSWORD } from "./setup";
import { ROLES, PERMISSIONS, roleHasPermission, canTransition } from "../src/modules/roles/roles";

const app = createApp();

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await closeTestPool();
});

describe("Owner-only routes", () => {
  it("rejects a non-owner (reception) from listing users", async () => {
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/login").send({ username: "test.reception", password: TEST_PASSWORD });
    const res = await agent.get("/api/v1/users");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("allows the owner to list users", async () => {
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/login").send({ username: "test.owner", password: TEST_PASSWORD });
    const res = await agent.get("/api/v1/users");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.users)).toBe(true);
  });

  it("rejects an unauthenticated request outright", async () => {
    const res = await request(app).get("/api/v1/users");
    expect(res.status).toBe(401);
  });
});

describe("Correction #1/#2 — Reception is the sole cashier; pharmacy never collects payment", () => {
  it("only reception holds COLLECT_PAYMENT", () => {
    expect(roleHasPermission(ROLES.RECEPTION, PERMISSIONS.COLLECT_PAYMENT)).toBe(true);
    expect(roleHasPermission(ROLES.PHARMACY, PERMISSIONS.COLLECT_PAYMENT)).toBe(false);
    expect(roleHasPermission(ROLES.OWNER, PERMISSIONS.COLLECT_PAYMENT)).toBe(false);
    expect(roleHasPermission(ROLES.NURSE, PERMISSIONS.COLLECT_PAYMENT)).toBe(false);
    expect(roleHasPermission(ROLES.DOCTOR, PERMISSIONS.COLLECT_PAYMENT)).toBe(false);
    expect(roleHasPermission(ROLES.LAB_TECH, PERMISSIONS.COLLECT_PAYMENT)).toBe(false);
  });
});

describe("Correction #4 — Owner has inventory adjustment authority; pharmacy has operational only", () => {
  it("only owner holds MANAGE_INVENTORY_ADJUSTMENTS", () => {
    expect(roleHasPermission(ROLES.OWNER, PERMISSIONS.MANAGE_INVENTORY_ADJUSTMENTS)).toBe(true);
    expect(roleHasPermission(ROLES.PHARMACY, PERMISSIONS.MANAGE_INVENTORY_ADJUSTMENTS)).toBe(false);
  });

  it("pharmacy holds OPERATE_INVENTORY (receive/dispense) but owner alone can adjust", () => {
    expect(roleHasPermission(ROLES.PHARMACY, PERMISSIONS.OPERATE_INVENTORY)).toBe(true);
    expect(roleHasPermission(ROLES.OWNER, PERMISSIONS.OPERATE_INVENTORY)).toBe(false); // owner acts via adjustments, not day-to-day ops
  });
});

describe("Correction #3 — queue transitions are role-controlled per the actual workflow", () => {
  it("nurse can move a patient from waiting-for-nurse to with-nurse", () => {
    expect(canTransition(ROLES.NURSE, "WAITING_FOR_NURSE", "WITH_NURSE")).toBe(true);
  });

  it("nurse CANNOT push a patient straight to pharmacy (not nurse's step)", () => {
    expect(canTransition(ROLES.NURSE, "WITH_NURSE", "WAITING_FOR_PHARMACY")).toBe(false);
  });

  it("pharmacy CANNOT pull a patient out of waiting-for-doctor", () => {
    expect(canTransition(ROLES.PHARMACY, "WAITING_FOR_DOCTOR", "WITH_DOCTOR")).toBe(false);
  });

  it("only doctor can send a patient to the lab", () => {
    expect(canTransition(ROLES.DOCTOR, "WITH_DOCTOR", "WAITING_FOR_LAB")).toBe(true);
    expect(canTransition(ROLES.NURSE, "WITH_DOCTOR", "WAITING_FOR_LAB")).toBe(false);
    expect(canTransition(ROLES.LAB_TECH, "WITH_DOCTOR", "WAITING_FOR_LAB")).toBe(false);
  });

  it("only reception can complete billing and close the visit", () => {
    expect(canTransition(ROLES.RECEPTION, "WAITING_FOR_BILLING", "COMPLETED")).toBe(true);
    expect(canTransition(ROLES.PHARMACY, "WAITING_FOR_BILLING", "COMPLETED")).toBe(false);
    expect(canTransition(ROLES.DOCTOR, "WAITING_FOR_BILLING", "COMPLETED")).toBe(false);
  });
});
