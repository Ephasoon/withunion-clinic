import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { fetchCurrentUser, login, logout } from "./authApi";

const user = { id: "u1", fullName: "Amina Tesfaye", username: "amina", role: "reception", isActive: true };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchCurrentUser — GET /api/v1/auth/me", () => {
  it("returns the session user, requesting with credentials", async () => {
    const fetchMock = stubFetch(jsonResponse(200, { data: { user }, error: null, meta: null }));
    await expect(fetchCurrentUser()).resolves.toEqual(user);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/auth/me");
    expect(init?.method).toBe("GET");
    expect(init?.credentials).toBe("include");
  });

  it("resolves to null on 401 UNAUTHENTICATED (no session)", async () => {
    stubFetch(
      jsonResponse(401, {
        data: null,
        error: { code: "UNAUTHENTICATED", message: "You must be logged in", details: null },
        meta: null,
      })
    );
    await expect(fetchCurrentUser()).resolves.toBeNull();
  });

  it("throws on a server error rather than treating it as signed out", async () => {
    stubFetch(jsonResponse(500, { data: null, error: { code: "INTERNAL_ERROR", message: "x" }, meta: null }));
    await expect(fetchCurrentUser()).rejects.toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
  });
});

describe("login — POST /api/v1/auth/login", () => {
  it("sends { username, password } as JSON with credentials and returns the user", async () => {
    const fetchMock = stubFetch(jsonResponse(200, { data: { user }, error: null, meta: null }));
    await expect(login({ username: "amina", password: "secret-pass" })).resolves.toEqual(user);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/auth/login");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect(JSON.parse(init?.body as string)).toEqual({ username: "amina", password: "secret-pass" });
  });

  it("throws ApiError INVALID_CREDENTIALS on wrong credentials", async () => {
    stubFetch(
      jsonResponse(401, {
        data: null,
        error: { code: "INVALID_CREDENTIALS", message: "Invalid username or password", details: null },
        meta: null,
      })
    );
    const error = await login({ username: "amina", password: "wrong" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
  });
});

describe("logout — POST /api/v1/auth/logout", () => {
  it("posts with no body and credentials", async () => {
    const fetchMock = stubFetch(jsonResponse(200, { data: { loggedOut: true }, error: null, meta: null }));
    await expect(logout()).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/auth/logout");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    expect(init?.credentials).toBe("include");
  });
});
