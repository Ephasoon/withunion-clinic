import { afterEach, describe, expect, it, vi } from "vitest";
import { createPatient, searchPatients } from "./patients/api";
import { createVisit, transitionVisit } from "./visits/api";

/** Checks the exact requests the feature API functions send, against docs/api-inventory.md §5.3–5.4. */

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({ data: body, error: null, meta: null }), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const call = (fetchMock: ReturnType<typeof stubFetch>) => {
  const [url, init] = fetchMock.mock.calls[0]!;
  return { url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body as string) : undefined };
};

afterEach(() => vi.unstubAllGlobals());

describe("searchPatients — GET /api/v1/patients", () => {
  it("sends search and limit", async () => {
    const fetchMock = stubFetch({ patients: [] });
    await searchPatients({ search: " amina ", limit: 20 });
    expect(call(fetchMock).url).toBe("/api/v1/patients?search=amina&limit=20");
  });

  it("omits a blank search so the backend returns the newest patients", async () => {
    const fetchMock = stubFetch({ patients: [] });
    await searchPatients({ search: "   ", limit: 100 });
    expect(call(fetchMock).url).toBe("/api/v1/patients?limit=100");
  });
});

describe("createPatient — POST /api/v1/patients", () => {
  it("posts the body unchanged, dateOfBirth as a plain string", async () => {
    const fetchMock = stubFetch({ patient: { id: "p1" } }, 201);
    await createPatient({ fullName: "Amina", gender: "female", dateOfBirth: "1990-05-14" });
    expect(call(fetchMock)).toEqual({
      url: "/api/v1/patients",
      method: "POST",
      body: { fullName: "Amina", gender: "female", dateOfBirth: "1990-05-14" },
    });
  });
});

describe("createVisit — POST /api/v1/visits", () => {
  it("posts only the patientId", async () => {
    const fetchMock = stubFetch({ visit: { id: "v1" } }, 201);
    await createVisit("11111111-1111-4111-8111-111111111111");
    expect(call(fetchMock)).toEqual({
      url: "/api/v1/visits",
      method: "POST",
      body: { patientId: "11111111-1111-4111-8111-111111111111" },
    });
  });
});

describe("transitionVisit — POST /api/v1/visits/:id/transition", () => {
  it("sends a hand-off with no reason", async () => {
    const fetchMock = stubFetch({ visit: { id: "v1" } });
    await transitionVisit("v1", { toStatus: "WAITING_FOR_NURSE" });
    expect(call(fetchMock)).toEqual({
      url: "/api/v1/visits/v1/transition",
      method: "POST",
      body: { toStatus: "WAITING_FOR_NURSE" },
    });
  });

  it("sends cancel with its reason", async () => {
    const fetchMock = stubFetch({ visit: { id: "v1" } });
    await transitionVisit("v1", { toStatus: "CANCELLED", reason: "Patient left" });
    expect(call(fetchMock).body).toEqual({ toStatus: "CANCELLED", reason: "Patient left" });
  });
});
