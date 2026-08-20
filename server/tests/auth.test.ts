import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { seedTestUsers, closeTestPool, TEST_PASSWORD } from "./setup";

const app = createApp();

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await closeTestPool();
});

describe("POST /api/v1/auth/login", () => {
  it("rejects an unknown username", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "no.such.user", password: "whatever" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects a wrong password", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "test.owner", password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("rejects a deactivated user even with the correct password", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "test.inactive", password: TEST_PASSWORD });
    expect(res.status).toBe(401);
    // Same generic error as any other failure — never reveals the
    // account exists but is deactivated.
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("logs in a valid active user and sets a session cookie", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "test.owner", password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.user.username).toBe("test.owner");
    expect(res.body.data.user.role).toBe("owner");
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("rejects a malformed request body (validation)", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ username: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/v1/auth/me", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns the current user for an authenticated session", async () => {
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/login").send({ username: "test.owner", password: TEST_PASSWORD });
    const res = await agent.get("/api/v1/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.data.user.username).toBe("test.owner");
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("ends the session so /me is rejected afterward", async () => {
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/login").send({ username: "test.owner", password: TEST_PASSWORD });
    const logoutRes = await agent.post("/api/v1/auth/logout");
    expect(logoutRes.status).toBe(200);

    const meRes = await agent.get("/api/v1/auth/me");
    expect(meRes.status).toBe(401);
  });
});
