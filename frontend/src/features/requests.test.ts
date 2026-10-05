import { afterEach, describe, expect, it, vi } from "vitest";
import { createPatient, searchPatients, updatePatient } from "./patients/api";
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

  it("sends includeInactive=true only when the box is ticked", async () => {
    const fetchMock = stubFetch({ patients: [] });
    await searchPatients({ search: "amina", limit: 20, includeInactive: true });
    expect(call(fetchMock).url).toBe("/api/v1/patients?search=amina&limit=20&includeInactive=true");
  });

  it("leaves includeInactive out when unticked or omitted (the backend default is active only)", async () => {
    const fetchMock = stubFetch({ patients: [] });
    await searchPatients({ search: "amina", limit: 20, includeInactive: false });
    expect(call(fetchMock).url).toBe("/api/v1/patients?search=amina&limit=20");
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { patients: [] }, error: null, meta: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    await searchPatients({ search: "", limit: 20 });
    expect(call(fetchMock).url).toBe("/api/v1/patients?limit=20");
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

describe("updatePatient — PATCH /api/v1/patients/:id", () => {
  it("sends only the given fields, with the session cookie", async () => {
    const fetchMock = stubFetch({ patient: { id: "p1" } });
    await updatePatient("p1", { status: "inactive" });
    expect(call(fetchMock)).toEqual({ url: "/api/v1/patients/p1", method: "PATCH", body: { status: "inactive" } });
    expect(fetchMock.mock.calls[0]![1]?.credentials).toBe("include");
  });

  it('sends a cleared field as "" and dateOfBirth as a plain string', async () => {
    const fetchMock = stubFetch({ patient: { id: "p1" } });
    await updatePatient("p1", { phone: "", dateOfBirth: "1985-01-01" });
    expect(call(fetchMock).body).toEqual({ phone: "", dateOfBirth: "1985-01-01" });
  });

  it("encodes the id in the path", async () => {
    const fetchMock = stubFetch({ patient: { id: "a/b" } });
    await updatePatient("a/b", { notes: "x" });
    expect(call(fetchMock).url).toBe("/api/v1/patients/a%2Fb");
  });

  it("returns the updated patient, and surfaces PATIENT_PHONE_ALREADY_EXISTS with its details", async () => {
    const patient = { id: "p1", status: "inactive" };
    stubFetch({ patient });
    await expect(updatePatient("p1", { status: "inactive" })).resolves.toEqual(patient);

    const details = { patientId: "p2", patientCode: "WU-000002", fullName: "Abebe" };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({ data: null, error: { code: "PATIENT_PHONE_ALREADY_EXISTS", message: "x", details }, meta: null }),
          { status: 409, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    await expect(updatePatient("p1", { phone: "0911" })).rejects.toMatchObject({
      status: 409,
      code: "PATIENT_PHONE_ALREADY_EXISTS",
      details,
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
