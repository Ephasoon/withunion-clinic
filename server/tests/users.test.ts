import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { seedTestUsers, closeTestPool, TEST_PASSWORD } from "./setup";
import { pool } from "../src/config/db";

const app = createApp();

async function loginAs(username: string, password = TEST_PASSWORD) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ username, password });
  return agent;
}

function uniqueUsername(base: string) {
  return `${base}.${Date.now()}.${Math.floor(Math.random() * 100000)}`;
}

/** Creates a disposable, non-owner user via the real API, for tests that mutate/destroy it. */
async function createDisposableUser(owner: request.Agent, role: string, username?: string) {
  const uname = username ?? uniqueUsername("disposable");
  const res = await owner.post("/api/v1/users").send({
    fullName: "Disposable Test User",
    username: uname,
    password: TEST_PASSWORD,
    role,
  });
  return { id: res.body.data.user.id as string, username: uname };
}

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await closeTestPool();
});

describe("Authorization", () => {
  it("rejects unauthenticated access to every endpoint", async () => {
    expect((await request(app).get("/api/v1/users")).status).toBe(401);
    expect((await request(app).get("/api/v1/users/00000000-0000-0000-0000-000000000000")).status).toBe(401);
    expect((await request(app).post("/api/v1/users")).status).toBe(401);
    expect((await request(app).patch("/api/v1/users/00000000-0000-0000-0000-000000000000")).status).toBe(401);
    expect(
      (await request(app).post("/api/v1/users/00000000-0000-0000-0000-000000000000/reset-password")).status
    ).toBe(401);
  });

  it("rejects every non-owner role from every write endpoint", async () => {
    const owner = await loginAs("test.owner");
    const { id } = await createDisposableUser(owner, "nurse");

    for (const username of ["test.reception", "test.nurse", "test.doctor", "test.lab", "test.pharmacy"]) {
      const agent = await loginAs(username);
      expect((await agent.get("/api/v1/users")).status).toBe(403);
      expect((await agent.get(`/api/v1/users/${id}`)).status).toBe(403);
      expect((await agent.post("/api/v1/users").send({})).status).toBe(403);
      expect((await agent.patch(`/api/v1/users/${id}`).send({ fullName: "X" })).status).toBe(403);
      expect((await agent.post(`/api/v1/users/${id}/reset-password`).send({ newPassword: "x" })).status).toBe(403);
    }
  });

  it("owner can access every endpoint", async () => {
    const owner = await loginAs("test.owner");
    expect((await owner.get("/api/v1/users")).status).toBe(200);
  });
});

describe("Create user", () => {
  it("creates a user successfully", async () => {
    const owner = await loginAs("test.owner");
    const username = uniqueUsername("newstaff");
    const res = await owner
      .post("/api/v1/users")
      .send({ fullName: "New Staff Member", username, password: "SecurePass123", role: "nurse" });
    expect(res.status).toBe(201);
    expect(res.body.data.user.username).toBe(username);
    expect(res.body.data.user.role).toBe("nurse");
    expect(res.body.data.user.isActive).toBe(true);
  });

  it("rejects a missing fullName", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner
      .post("/api/v1/users")
      .send({ username: uniqueUsername("x"), password: "SecurePass123", role: "nurse" });
    expect(res.status).toBe(400);
  });

  it("rejects a password shorter than 8 characters", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner
      .post("/api/v1/users")
      .send({ fullName: "X", username: uniqueUsername("x"), password: "short1", role: "nurse" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid role", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner
      .post("/api/v1/users")
      .send({ fullName: "X", username: uniqueUsername("x"), password: "SecurePass123", role: "superadmin" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid username charset", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner
      .post("/api/v1/users")
      .send({ fullName: "X", username: "bad username!", password: "SecurePass123", role: "nurse" });
    expect(res.status).toBe(400);
  });

  it("rejects unknown fields (strict schema)", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.post("/api/v1/users").send({
      fullName: "X",
      username: uniqueUsername("x"),
      password: "SecurePass123",
      role: "nurse",
      extra: "field",
    });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate username with a clean 409", async () => {
    const owner = await loginAs("test.owner");
    const username = uniqueUsername("dupe");
    await owner.post("/api/v1/users").send({ fullName: "First", username, password: "SecurePass123", role: "nurse" });

    const res = await owner
      .post("/api/v1/users")
      .send({ fullName: "Second", username, password: "SecurePass123", role: "doctor" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("USERNAME_ALREADY_EXISTS");
  });
});

describe("Get user detail", () => {
  it("returns 404 for a non-existent user", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.get("/api/v1/users/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("returns the user detail", async () => {
    const owner = await loginAs("test.owner");
    const { id, username } = await createDisposableUser(owner, "doctor");
    const res = await owner.get(`/api/v1/users/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.username).toBe(username);
  });
});

describe("Update user — fullName and role", () => {
  it("updates fullName only", async () => {
    const owner = await loginAs("test.owner");
    const { id } = await createDisposableUser(owner, "nurse");
    const res = await owner.patch(`/api/v1/users/${id}`).send({ fullName: "Renamed Person" });
    expect(res.status).toBe(200);
    expect(res.body.data.user.fullName).toBe("Renamed Person");
  });

  it("rejects an empty patch body", async () => {
    const owner = await loginAs("test.owner");
    const { id } = await createDisposableUser(owner, "nurse");
    const res = await owner.patch(`/api/v1/users/${id}`).send({});
    expect(res.status).toBe(400);
  });

  it("changes a user's role", async () => {
    const owner = await loginAs("test.owner");
    const { id } = await createDisposableUser(owner, "nurse");
    const res = await owner.patch(`/api/v1/users/${id}`).send({ role: "doctor" });
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe("doctor");
  });
});

describe("Deactivate / reactivate", () => {
  it("deactivates a user", async () => {
    const owner = await loginAs("test.owner");
    const { id } = await createDisposableUser(owner, "nurse");
    const res = await owner.patch(`/api/v1/users/${id}`).send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.user.isActive).toBe(false);
  });

  it("a deactivated user cannot log in", async () => {
    const owner = await loginAs("test.owner");
    const { id, username } = await createDisposableUser(owner, "nurse");
    await owner.patch(`/api/v1/users/${id}`).send({ isActive: false });

    const loginRes = await request(app).post("/api/v1/auth/login").send({ username, password: TEST_PASSWORD });
    expect(loginRes.status).toBe(401);
  });

  it("reactivates a deactivated user", async () => {
    const owner = await loginAs("test.owner");
    const { id, username } = await createDisposableUser(owner, "nurse");
    await owner.patch(`/api/v1/users/${id}`).send({ isActive: false });

    const res = await owner.patch(`/api/v1/users/${id}`).send({ isActive: true });
    expect(res.status).toBe(200);
    expect(res.body.data.user.isActive).toBe(true);

    const loginRes = await request(app).post("/api/v1/auth/login").send({ username, password: TEST_PASSWORD });
    expect(loginRes.status).toBe(200);
  });
});

describe("Self-modification protections", () => {
  it("blocks self-deactivation", async () => {
    const owner = await loginAs("test.owner");
    const me = await owner.get("/api/v1/auth/me");
    const ownerId = me.body.data.user.id;

    const res = await owner.patch(`/api/v1/users/${ownerId}`).send({ isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SELF_DEACTIVATION_NOT_ALLOWED");
  });

  it("blocks self-demotion away from Owner", async () => {
    const owner = await loginAs("test.owner2");
    const me = await owner.get("/api/v1/auth/me");
    const ownerId = me.body.data.user.id;

    const res = await owner.patch(`/api/v1/users/${ownerId}`).send({ role: "reception" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SELF_DEMOTION_NOT_ALLOWED");
  });

  it("allows an owner to edit their own fullName", async () => {
    const owner = await loginAs("test.owner");
    const me = await owner.get("/api/v1/auth/me");
    const ownerId = me.body.data.user.id;

    const res = await owner.patch(`/api/v1/users/${ownerId}`).send({ fullName: "Test Owner" });
    expect(res.status).toBe(200);
  });
});

describe("Last active Owner protection", () => {
  it("prevents deactivating the only remaining active Owner", async () => {
    const owner = await loginAs("test.owner");
    const { id: soleOwnerId } = await createDisposableUser(owner, "owner");

    // Temporarily neutralize every OTHER active owner in the system
    // (the seeded fixtures plus any created by earlier tests in this
    // run) so soleOwnerId genuinely becomes the last one -- restoring
    // them all in `finally` regardless of outcome, so no other test
    // file is affected by this one's global-state manipulation.
    const othersResult = await pool.query(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.name = 'owner' AND u.is_active = true AND u.id != $1`,
      [soleOwnerId]
    );
    const otherOwnerIds: string[] = othersResult.rows.map((r) => r.id);

    try {
      await pool.query(`UPDATE users SET is_active = false WHERE id = ANY($1)`, [otherOwnerIds]);

      const res = await owner.patch(`/api/v1/users/${soleOwnerId}`).send({ isActive: false });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("LAST_ACTIVE_OWNER");

      const demoteRes = await owner.patch(`/api/v1/users/${soleOwnerId}`).send({ role: "reception" });
      expect(demoteRes.status).toBe(409);
      expect(demoteRes.body.error.code).toBe("LAST_ACTIVE_OWNER");
    } finally {
      await pool.query(`UPDATE users SET is_active = true WHERE id = ANY($1)`, [otherOwnerIds]);
    }
  });

  it("allows deactivating an Owner when another active Owner remains", async () => {
    const owner = await loginAs("test.owner");
    const { id } = await createDisposableUser(owner, "owner");
    // test.owner and test.owner2 remain active throughout, so this is safe.
    const res = await owner.patch(`/api/v1/users/${id}`).send({ isActive: false });
    expect(res.status).toBe(200);
  });
});

describe("Password reset", () => {
  it("resets the password; old password stops working, new one works", async () => {
    const owner = await loginAs("test.owner");
    const { id, username } = await createDisposableUser(owner, "nurse");

    const resetRes = await owner.post(`/api/v1/users/${id}/reset-password`).send({ newPassword: "BrandNewPass123" });
    expect(resetRes.status).toBe(200);

    const oldLogin = await request(app).post("/api/v1/auth/login").send({ username, password: TEST_PASSWORD });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ username, password: "BrandNewPass123" });
    expect(newLogin.status).toBe(200);
  });

  it("rejects a new password shorter than 8 characters", async () => {
    const owner = await loginAs("test.owner");
    const { id } = await createDisposableUser(owner, "nurse");
    const res = await owner.post(`/api/v1/users/${id}/reset-password`).send({ newPassword: "short" });
    expect(res.status).toBe(400);
  });
});

describe("Session invalidation", () => {
  it("invalidates the target's active session after a role change", async () => {
    const owner = await loginAs("test.owner");
    const { id, username } = await createDisposableUser(owner, "nurse");
    const target = await loginAs(username);
    expect((await target.get("/api/v1/auth/me")).status).toBe(200);

    await owner.patch(`/api/v1/users/${id}`).send({ role: "doctor" });

    expect((await target.get("/api/v1/auth/me")).status).toBe(401);
  });

  it("invalidates the target's active session after deactivation", async () => {
    const owner = await loginAs("test.owner");
    const { id, username } = await createDisposableUser(owner, "nurse");
    const target = await loginAs(username);
    expect((await target.get("/api/v1/auth/me")).status).toBe(200);

    await owner.patch(`/api/v1/users/${id}`).send({ isActive: false });

    expect((await target.get("/api/v1/auth/me")).status).toBe(401);
  });

  it("invalidates the target's active session after a password reset", async () => {
    const owner = await loginAs("test.owner");
    const { id, username } = await createDisposableUser(owner, "nurse");
    const target = await loginAs(username);
    expect((await target.get("/api/v1/auth/me")).status).toBe(200);

    await owner.post(`/api/v1/users/${id}/reset-password`).send({ newPassword: "AnotherPass123" });

    expect((await target.get("/api/v1/auth/me")).status).toBe(401);
  });

  it("does NOT invalidate an unrelated user's session on someone else's role change", async () => {
    const owner = await loginAs("test.owner");
    const { id: idA } = await createDisposableUser(owner, "nurse");
    const { username: usernameB } = await createDisposableUser(owner, "nurse");
    const bystander = await loginAs(usernameB);
    expect((await bystander.get("/api/v1/auth/me")).status).toBe(200);

    await owner.patch(`/api/v1/users/${idA}`).send({ role: "doctor" });

    expect((await bystander.get("/api/v1/auth/me")).status).toBe(200);
  });

  it("a plain fullName edit does NOT invalidate the target's session", async () => {
    const owner = await loginAs("test.owner");
    const { id, username } = await createDisposableUser(owner, "nurse");
    const target = await loginAs(username);
    expect((await target.get("/api/v1/auth/me")).status).toBe(200);

    await owner.patch(`/api/v1/users/${id}`).send({ fullName: "Renamed But Still Logged In" });

    expect((await target.get("/api/v1/auth/me")).status).toBe(200);
  });
});

describe("Audit events", () => {
  it("user.create is recorded", async () => {
    const owner = await loginAs("test.owner");
    const before = new Date();
    const { id } = await createDisposableUser(owner, "nurse");

    const auditRes = await pool.query(
      `SELECT action FROM audit_logs WHERE created_at >= $1 AND entity_id = $2 AND action = 'user.create'`,
      [before, id]
    );
    expect(auditRes.rows.length).toBeGreaterThan(0);
  });

  it("user.update and user.deactivate are both recorded for a deactivation", async () => {
    const owner = await loginAs("test.owner");
    const { id } = await createDisposableUser(owner, "nurse");
    const before = new Date();
    await owner.patch(`/api/v1/users/${id}`).send({ isActive: false });

    const auditRes = await pool.query(
      `SELECT action FROM audit_logs WHERE created_at >= $1 AND entity_id = $2 ORDER BY created_at`,
      [before, id]
    );
    const actions = auditRes.rows.map((r) => r.action);
    expect(actions).toContain("user.update");
    expect(actions).toContain("user.deactivate");
  });

  it("user.password_reset is recorded", async () => {
    const owner = await loginAs("test.owner");
    const { id } = await createDisposableUser(owner, "nurse");
    const before = new Date();
    await owner.post(`/api/v1/users/${id}/reset-password`).send({ newPassword: "YetAnotherPass123" });

    const auditRes = await pool.query(
      `SELECT action FROM audit_logs WHERE created_at >= $1 AND entity_id = $2 AND action = 'user.password_reset'`,
      [before, id]
    );
    expect(auditRes.rows.length).toBeGreaterThan(0);
  });
});
