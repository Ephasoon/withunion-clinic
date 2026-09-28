import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchVitals, recordAssessment, recordVitals, startNursing } from "./api";

/** The exact requests the nursing API functions send, against docs/api-inventory.md §5.4–5.5. */

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

describe("startNursing", () => {
  it("sends only WITH_NURSE through the generic transition endpoint", async () => {
    const fetchMock = stubFetch({ visit: { id: "v1" } });
    await startNursing("v1");
    expect(call(fetchMock)).toEqual({
      url: "/api/v1/visits/v1/transition",
      method: "POST",
      body: { toStatus: "WITH_NURSE" },
    });
  });
});

describe("recordAssessment", () => {
  it("posts to the nursing-assessment endpoint, never to /transition", async () => {
    const fetchMock = stubFetch({ assessment: { id: "a1" }, visitStatus: "WAITING_FOR_DOCTOR" }, 201);
    await recordAssessment("v1", { chiefComplaint: "Headache" });
    expect(call(fetchMock)).toEqual({
      url: "/api/v1/visits/v1/nursing-assessment",
      method: "POST",
      body: { chiefComplaint: "Headache" },
    });
  });
});

describe("vitals", () => {
  const apiRow = {
    id: "vs1",
    visitId: "v1",
    recordedBy: "n1",
    bloodPressureSystolic: 120,
    bloodPressureDiastolic: 80,
    pulseBpm: null,
    temperatureCelsius: "37.5",
    weightKg: "70.25",
    heightCm: "170.0",
    respiratoryRate: null,
    oxygenSaturationPct: null,
    notes: null,
    recordedAt: "2026-09-28T08:00:00.000Z",
  };

  it("fetchVitals converts the string columns to numbers", async () => {
    stubFetch({ vitals: [apiRow] });
    const [vitals] = await fetchVitals("v1");
    expect(vitals).toMatchObject({ temperatureCelsius: 37.5, weightKg: 70.25, heightCm: 170 });
  });

  it("recordVitals posts numbers and converts the response", async () => {
    const fetchMock = stubFetch({ vitals: apiRow }, 201);
    const saved = await recordVitals("v1", { temperatureCelsius: 37.5, weightKg: 70.25 });
    expect(call(fetchMock)).toEqual({
      url: "/api/v1/visits/v1/vitals",
      method: "POST",
      body: { temperatureCelsius: 37.5, weightKg: 70.25 },
    });
    expect(saved.temperatureCelsius).toBe(37.5);
  });
});
