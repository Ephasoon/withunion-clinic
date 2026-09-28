import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDiagnosis,
  completeConsultation,
  createLabOrder,
  createPrescription,
  openConsultation,
  takeBackForReview,
  updateNotes,
} from "./api";

/** The exact requests the doctor API functions send, against docs/api-inventory.md §5.6. */

function stubFetch(data: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({ data, error: null, meta: null }), {
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

describe("visit-level calls", () => {
  it("openConsultation posts with no body to /visits/:id/consultations", async () => {
    const fetchMock = stubFetch({ consultation: { id: "c1" } }, 201);
    await openConsultation("v1");
    expect(call(fetchMock)).toEqual({ url: "/api/v1/visits/v1/consultations", method: "POST", body: undefined });
  });

  it("takeBackForReview sends only WITH_DOCTOR to the generic transition", async () => {
    const fetchMock = stubFetch({ visit: { id: "v1" } });
    await takeBackForReview("v1");
    expect(call(fetchMock)).toEqual({
      url: "/api/v1/visits/v1/transition",
      method: "POST",
      body: { toStatus: "WITH_DOCTOR" },
    });
  });
});

describe("consultation-level calls", () => {
  it("updateNotes PATCHes { notes }", async () => {
    const fetchMock = stubFetch({ consultation: { id: "c1" } });
    await updateNotes("c1", "Fever");
    expect(call(fetchMock)).toEqual({ url: "/api/v1/consultations/c1", method: "PATCH", body: { notes: "Fever" } });
  });

  it("addDiagnosis posts { description }", async () => {
    const fetchMock = stubFetch({ diagnosis: { id: "d1" } }, 201);
    await addDiagnosis("c1", "Malaria");
    expect(call(fetchMock).body).toEqual({ description: "Malaria" });
  });

  it("createLabOrder posts { testNames } and reads the labOrder key", async () => {
    const fetchMock = stubFetch({ labOrder: { id: "lo1", testNames: ["CBC"] } }, 201);
    const created = await createLabOrder("c1", ["CBC"]);
    expect(call(fetchMock)).toEqual({
      url: "/api/v1/consultations/c1/lab-orders",
      method: "POST",
      body: { testNames: ["CBC"] },
    });
    expect(created.id).toBe("lo1");
  });

  it("createPrescription posts { items } with free-text medicine names", async () => {
    const fetchMock = stubFetch({ prescription: { id: "p1" } }, 201);
    await createPrescription("c1", [{ medicineName: "Amoxicillin 500mg", quantityPrescribed: 15 }]);
    expect(call(fetchMock).body).toEqual({ items: [{ medicineName: "Amoxicillin 500mg", quantityPrescribed: 15 }] });
  });

  it("completeConsultation posts with no body and returns visitStatus", async () => {
    const fetchMock = stubFetch({ consultation: { id: "c1" }, visitStatus: "WAITING_FOR_LAB" });
    const result = await completeConsultation("c1");
    expect(call(fetchMock)).toEqual({ url: "/api/v1/consultations/c1/complete", method: "POST", body: undefined });
    expect(result.visitStatus).toBe("WAITING_FOR_LAB");
  });
});
