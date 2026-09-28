import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api";
import { ALL_ROLES, type Role } from "../../rbac/roles";
import { createUser, fetchUser, fetchUsers, resetUserPassword, updateUser } from "./api";
import { userErrorMessage } from "./userErrors";
import {
  buildUserPatch,
  changeEndsSessions,
  countOtherActiveOwners,
  editConstraints,
  validateCreateUser,
  validatePassword,
  validateUsername,
  wouldRemoveLastActiveOwner,
} from "./userRules";

const u = (id: string, role: Role, isActive = true) => ({ id, role, isActive });

describe("editConstraints — own account (self-deactivation / self-demotion)", () => {
  const me = u("me", "owner");
  const users = [me, u("o2", "owner"), u("n1", "nurse")];

  it("blocks deactivating yourself and every role except owner, with reasons", () => {
    const c = editConstraints("me", me, users);
    expect(c.isSelf).toBe(true);
    expect(c.deactivateBlockedReason).toBe("You can’t deactivate your own account.");
    expect(c.allowedRoles).toEqual(["owner"]);
    expect(c.roleBlockedReason).toMatch(/own role/);
  });

  it("applies even when other active owners exist", () => {
    expect(editConstraints("me", me, users).allowedRoles).toEqual(["owner"]);
  });
});

describe("editConstraints — other users", () => {
  it("allows everything for a non-owner", () => {
    const c = editConstraints("me", u("n1", "nurse"), [u("me", "owner"), u("n1", "nurse")]);
    expect(c).toEqual({ isSelf: false, deactivateBlockedReason: null, allowedRoles: [...ALL_ROLES], roleBlockedReason: null });
  });

  it("allows changing another owner while at least one other active owner remains", () => {
    const c = editConstraints("me", u("o2", "owner"), [u("me", "owner"), u("o2", "owner")]);
    expect(c.deactivateBlockedReason).toBeNull();
    expect(c.allowedRoles).toEqual([...ALL_ROLES]);
  });

  it("blocks deactivating or demoting the only active owner", () => {
    // The caller is an inactive owner here (e.g. data changed since sign-in), so o2 is the last active one.
    const c = editConstraints("me", u("o2", "owner"), [u("me", "owner", false), u("o2", "owner")]);
    expect(c.deactivateBlockedReason).toMatch(/only active Owner/);
    expect(c.allowedRoles).toEqual(["owner"]);
    expect(c.roleBlockedReason).toMatch(/only active Owner/);
  });

  it("never blocks reactivating or re-roling an inactive owner", () => {
    const c = editConstraints("me", u("o3", "owner", false), [u("me", "owner"), u("o3", "owner", false)]);
    expect(c.deactivateBlockedReason).toBeNull();
    expect(c.allowedRoles).toEqual([...ALL_ROLES]);
  });
});

describe("last-active-owner calculation", () => {
  const list = [u("a", "owner"), u("b", "owner", false), u("c", "nurse"), u("d", "owner")];

  it("counts other active owners only", () => {
    expect(countOtherActiveOwners(list, "a")).toBe(1);
    expect(countOtherActiveOwners(list, "c")).toBe(2);
    expect(countOtherActiveOwners([u("a", "owner")], "a")).toBe(0);
  });

  it("mirrors the backend: only an active owner who stops being one, with no other active owner", () => {
    const solo = [u("a", "owner"), u("c", "nurse")];
    expect(wouldRemoveLastActiveOwner(u("a", "owner"), { isActive: false }, solo)).toBe(true);
    expect(wouldRemoveLastActiveOwner(u("a", "owner"), { role: "doctor" }, solo)).toBe(true);
    expect(wouldRemoveLastActiveOwner(u("a", "owner"), { role: "owner", isActive: true }, solo)).toBe(false);
    expect(wouldRemoveLastActiveOwner(u("a", "owner"), { isActive: false }, list)).toBe(false);
    expect(wouldRemoveLastActiveOwner(u("c", "nurse"), { isActive: false }, solo)).toBe(false);
    expect(wouldRemoveLastActiveOwner(u("b", "owner", false), { role: "nurse" }, solo)).toBe(false);
  });
});

describe("username and password validation", () => {
  it("accepts letters, numbers, dot, underscore, hyphen", () => {
    for (const ok of ["amina", "a.tesfaye", "lab_tech-2", "ABC123"]) expect(validateUsername(ok), ok).toBeNull();
  });

  it("refuses blank, spaces, other characters and more than 100 chars", () => {
    for (const bad of ["", "   ", "amina tesfaye", "amina@clinic", "amína", "a/b"]) expect(validateUsername(bad), bad).not.toBeNull();
    expect(validateUsername("a".repeat(100))).toBeNull();
    expect(validateUsername("a".repeat(101))).not.toBeNull();
  });

  it("password 8–200 characters, not trimmed", () => {
    expect(validatePassword("1234567")).not.toBeNull();
    expect(validatePassword("12345678")).toBeNull();
    expect(validatePassword("p".repeat(200))).toBeNull();
    expect(validatePassword("p".repeat(201))).not.toBeNull();
    expect(validatePassword("  123456")).toBeNull(); // 8 chars including spaces, as the backend counts them
  });

  it("validateCreateUser trims name and username but not the password", () => {
    expect(validateCreateUser({ fullName: " Amina ", username: " amina ", password: " secret123 ", role: "nurse" })).toEqual({
      ok: true,
      body: { fullName: "Amina", username: "amina", password: " secret123 ", role: "nurse" },
    });
    const bad = validateCreateUser({ fullName: "", username: "a b", password: "short", role: "" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["fullName", "password", "role", "username"]);
  });
});

describe("buildUserPatch", () => {
  const original = { fullName: "Amina", role: "nurse" as Role, isActive: true };

  it("sends only changed fields", () => {
    expect(buildUserPatch(original, { fullName: "Amina T", role: "nurse", isActive: true })).toEqual({
      ok: true,
      body: { fullName: "Amina T" },
    });
    expect(buildUserPatch(original, { fullName: "Amina", role: "doctor", isActive: false })).toEqual({
      ok: true,
      body: { role: "doctor", isActive: false },
    });
  });

  it("refuses an unchanged form with a generic 'change at least one field'", () => {
    const result = buildUserPatch(original, { fullName: " Amina ", role: "nurse", isActive: true });
    expect(result).toEqual({ ok: false, error: "Change at least one field (name, role or active status) before saving." });
  });

  it("knows which changes end the target's sessions", () => {
    expect(changeEndsSessions(original, { role: "doctor" })).toBe(true);
    expect(changeEndsSessions(original, { isActive: false })).toBe(true);
    expect(changeEndsSessions({ role: "nurse", isActive: false }, { isActive: true })).toBe(false);
  });
});

describe("userErrorMessage", () => {
  it("maps the users error codes", () => {
    expect(userErrorMessage(new ApiError(409, "USERNAME_ALREADY_EXISTS", 'Username "amina" is already in use'), "create")).toMatch(/already taken/);
    expect(userErrorMessage(new ApiError(409, "SELF_DEACTIVATION_NOT_ALLOWED", "x"), "update")).toMatch(/deactivate your own/);
    expect(userErrorMessage(new ApiError(409, "SELF_DEMOTION_NOT_ALLOWED", "x"), "update")).toMatch(/own role/);
    expect(userErrorMessage(new ApiError(409, "LAST_ACTIVE_OWNER", "x"), "update")).toMatch(/no active Owner/);
  });

  it("PATCH's refine has no path: empty details become 'change at least one field'", () => {
    expect(userErrorMessage(new ApiError(400, "VALIDATION_ERROR", "Invalid request body", {}), "update")).toBe(
      "Change at least one field (name, role or active status) before saving."
    );
  });

  it("shows field messages when the backend sends them", () => {
    expect(
      userErrorMessage(new ApiError(400, "VALIDATION_ERROR", "Invalid request body", { username: ["username may only contain…"] }), "create")
    ).toBe("Username: username may only contain…");
  });

  it("never shows a submitted password, even if an error message echoed it", () => {
    const secret = "Sup3rSecret!";
    const echoing = new ApiError(400, "SOMETHING_NEW", `Bad value ${secret}`);
    const shown = userErrorMessage(echoing, "reset-password", [secret]);
    expect(shown).not.toContain(secret);
    expect(shown).toBe("The request failed. Please check the form and try again.");
    const echoingDetails = new ApiError(400, "VALIDATION_ERROR", "Invalid request body", { password: [`"${secret}" is too weak`] });
    expect(userErrorMessage(echoingDetails, "create", [secret])).not.toContain(secret);
  });
});

describe("users API requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(data: unknown) {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data, error: null, meta: null }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const call = (fetchMock: ReturnType<typeof stubFetch>) => {
    const [url, init] = fetchMock.mock.calls[0]!;
    return { url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body as string) : undefined };
  };

  it("GET /api/v1/users and /api/v1/users/:id", async () => {
    let fetchMock = stubFetch({ users: [] });
    await fetchUsers();
    expect(call(fetchMock).url).toBe("/api/v1/users");
    fetchMock = stubFetch({ user: { id: "u1" } });
    await fetchUser("u1");
    expect(call(fetchMock).url).toBe("/api/v1/users/u1");
  });

  it("POST /api/v1/users with exactly fullName, username, password, role", async () => {
    const fetchMock = stubFetch({ user: { id: "u1" } });
    await createUser({ fullName: "Amina", username: "amina", password: "secret123", role: "nurse" });
    expect(call(fetchMock)).toEqual({
      url: "/api/v1/users",
      method: "POST",
      body: { fullName: "Amina", username: "amina", password: "secret123", role: "nurse" },
    });
  });

  it("PATCH /api/v1/users/:id with only the changed fields", async () => {
    const fetchMock = stubFetch({ user: { id: "u1" } });
    await updateUser("u1", { isActive: false });
    expect(call(fetchMock)).toEqual({ url: "/api/v1/users/u1", method: "PATCH", body: { isActive: false } });
  });

  it("POST /api/v1/users/:id/reset-password { newPassword }", async () => {
    const fetchMock = stubFetch({ user: { id: "u1" } });
    await resetUserPassword("u1", "newpass123");
    expect(call(fetchMock)).toEqual({
      url: "/api/v1/users/u1/reset-password",
      method: "POST",
      body: { newPassword: "newpass123" },
    });
  });
});
