import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDashboard } from "./api";
import { activeByRoleDisplayList, byStatusDisplayList, NON_TERMINAL_STATUSES } from "./dashboardDisplay";

describe("byStatusDisplayList", () => {
  it("lists all 11 non-terminal statuses in workflow order with labels", () => {
    const record = Object.fromEntries(NON_TERMINAL_STATUSES.map((s, i) => [s, i]));
    const rows = byStatusDisplayList(record);
    expect(NON_TERMINAL_STATUSES).toHaveLength(11);
    expect(rows.map((r) => r.key)).toEqual([...NON_TERMINAL_STATUSES]);
    expect(rows[0]).toEqual({ key: "REGISTERED", label: "Registered", count: 0 });
    expect(rows[10]).toEqual({ key: "WAITING_FOR_BILLING", label: "Waiting for billing", count: 10 });
    expect(rows.some((r) => r.key === "COMPLETED" || r.key === "CANCELLED")).toBe(false);
  });

  it("shows 0 for a missing status and keeps an unknown one under its raw name", () => {
    const rows = byStatusDisplayList({ WITH_DOCTOR: 4, NEW_STATUS: 2 });
    expect(rows.find((r) => r.key === "WITH_DOCTOR")?.count).toBe(4);
    expect(rows.find((r) => r.key === "REGISTERED")?.count).toBe(0);
    expect(rows.at(-1)).toEqual({ key: "NEW_STATUS", label: "NEW_STATUS", count: 2 });
    expect(rows).toHaveLength(12);
  });
});

describe("activeByRoleDisplayList", () => {
  it("lists all 6 roles in order with labels", () => {
    const rows = activeByRoleDisplayList({ owner: 1, reception: 2, nurse: 3, doctor: 4, lab_tech: 5, pharmacy: 6 });
    expect(rows).toEqual([
      { key: "owner", label: "Owner", count: 1 },
      { key: "reception", label: "Reception", count: 2 },
      { key: "nurse", label: "Nurse", count: 3 },
      { key: "doctor", label: "Doctor", count: 4 },
      { key: "lab_tech", label: "Lab technician", count: 5 },
      { key: "pharmacy", label: "Pharmacy", count: 6 },
    ]);
  });

  it("shows 0 for a missing role", () => {
    expect(activeByRoleDisplayList({}).every((r) => r.count === 0)).toBe(true);
  });
});

describe("fetchDashboard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the envelope's data as the snapshot itself (no wrapping key)", async () => {
    const snapshot = { generatedAt: "2026-09-28T10:00:00.000Z", patients: { registeredToday: 3 } };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: snapshot, error: null, meta: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchDashboard()).toEqual(snapshot);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/v1/dashboard");
  });
});
