import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiUrl } from "../../api";
import { fetchAuditLog, fetchAuditLogs } from "./api";
import {
  auditLogParams,
  EMPTY_AUDIT_FILTERS,
  formatJsonValue,
  localDayEndIso,
  localDayStartIso,
  pageInfo,
  validateAuditFilters,
} from "./auditParams";

const USER = "11111111-1111-4111-8111-111111111111";
const PAGE = { limit: 20, offset: 0 };

describe("local-day bounds for dateFrom/dateTo", () => {
  let savedTz: string | undefined;
  beforeEach(() => {
    savedTz = process.env.TZ;
  });
  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  it("covers the whole local day in UTC+3 (not UTC midnight)", () => {
    process.env.TZ = "Africa/Nairobi";
    expect(localDayStartIso("2026-09-28")).toBe("2026-09-27T21:00:00.000Z");
    expect(localDayEndIso("2026-09-28")).toBe("2026-09-28T20:59:59.999Z");
  });

  it("covers the whole local day in UTC−5", () => {
    process.env.TZ = "America/Bogota";
    expect(localDayStartIso("2026-09-28")).toBe("2026-09-28T05:00:00.000Z");
    expect(localDayEndIso("2026-09-28")).toBe("2026-09-29T04:59:59.999Z");
  });

  it("is local midnight to 23:59:59.999 in whatever zone the device is in", () => {
    const start = new Date(localDayStartIso("2026-02-28"));
    const end = new Date(localDayEndIso("2026-02-28"));
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()]).toEqual([2026, 1, 28, 0, 0]);
    expect([end.getFullYear(), end.getMonth(), end.getDate(), end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds()]).toEqual([
      2026, 1, 28, 23, 59, 59, 999,
    ]);
  });

  it("rejects anything that isn't a real YYYY-MM-DD date", () => {
    expect(() => localDayStartIso("2026-02-30")).toThrow();
    expect(() => localDayEndIso("28/09/2026")).toThrow();
  });
});

describe("auditLogParams", () => {
  it("sends only limit and offset when no filter is set", () => {
    expect(auditLogParams(EMPTY_AUDIT_FILTERS, PAGE)).toEqual({ limit: 20, offset: 0 });
  });

  it("trims text filters and leaves blank ones out", () => {
    const params = auditLogParams({ ...EMPTY_AUDIT_FILTERS, entity: " suppliers ", entityId: "   ", action: "supplier.update", userId: USER }, { limit: 50, offset: 100 });
    expect(params).toEqual({ entity: "suppliers", action: "supplier.update", userId: USER, limit: 50, offset: 100 });
  });

  it("sends dates as local-day ISO bounds", () => {
    const params = auditLogParams({ ...EMPTY_AUDIT_FILTERS, dateFrom: "2026-09-01", dateTo: "2026-09-28" }, PAGE);
    expect(params.dateFrom).toBe(localDayStartIso("2026-09-01"));
    expect(params.dateTo).toBe(localDayEndIso("2026-09-28"));
  });

  it("builds the exact request URL", () => {
    const savedTz = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      const params = auditLogParams({ ...EMPTY_AUDIT_FILTERS, entity: "purchases", dateTo: "2026-09-28" }, { limit: 20, offset: 40 });
      expect(apiUrl("/api/v1/audit-logs", params)).toBe(
        "/api/v1/audit-logs?entity=purchases&dateTo=2026-09-28T23%3A59%3A59.999Z&limit=20&offset=40"
      );
    } finally {
      if (savedTz === undefined) delete process.env.TZ;
      else process.env.TZ = savedTz;
    }
  });
});

describe("validateAuditFilters", () => {
  it("accepts empty filters", () => {
    expect(validateAuditFilters(EMPTY_AUDIT_FILTERS)).toEqual({});
  });

  it("limits text filters to 64 characters (after trimming)", () => {
    expect(validateAuditFilters({ ...EMPTY_AUDIT_FILTERS, entity: "x".repeat(64) })).toEqual({});
    expect(validateAuditFilters({ ...EMPTY_AUDIT_FILTERS, action: "x".repeat(65) }).action).toMatch(/64/);
    expect(validateAuditFilters({ ...EMPTY_AUDIT_FILTERS, entityId: ` ${"x".repeat(64)} ` })).toEqual({});
  });

  it("rejects invalid dates and a start after the end", () => {
    expect(validateAuditFilters({ ...EMPTY_AUDIT_FILTERS, dateFrom: "2026-13-01" }).dateFrom).toBe("Enter a valid date.");
    expect(validateAuditFilters({ ...EMPTY_AUDIT_FILTERS, dateFrom: "2026-09-29", dateTo: "2026-09-28" }).dateFrom).toMatch(/after/);
    expect(validateAuditFilters({ ...EMPTY_AUDIT_FILTERS, dateFrom: "2026-09-28", dateTo: "2026-09-28" })).toEqual({});
  });
});

describe("pageInfo", () => {
  it("first page of many", () => {
    expect(pageInfo({ total: 45, limit: 20, offset: 0, count: 20 })).toEqual({
      from: 1,
      to: 20,
      total: 45,
      hasPrevious: false,
      hasNext: true,
      previousOffset: 0,
      nextOffset: 20,
    });
  });

  it("last, partial page", () => {
    const info = pageInfo({ total: 45, limit: 20, offset: 40, count: 5 });
    expect(info).toMatchObject({ from: 41, to: 45, hasPrevious: true, hasNext: false, previousOffset: 20 });
  });

  it("exactly full last page has no next", () => {
    expect(pageInfo({ total: 40, limit: 20, offset: 20, count: 20 }).hasNext).toBe(false);
  });

  it("no results", () => {
    expect(pageInfo({ total: 0, limit: 20, offset: 0, count: 0 })).toMatchObject({ from: 0, to: 0, hasPrevious: false, hasNext: false });
  });

  it("an offset past the end (rows deleted meanwhile) still allows going back", () => {
    expect(pageInfo({ total: 10, limit: 20, offset: 20, count: 0 })).toMatchObject({ from: 0, hasPrevious: true, hasNext: false, previousOffset: 0 });
  });

  it("never offers a next offset beyond the backend's 1,000,000 maximum", () => {
    expect(pageInfo({ total: 5_000_000, limit: 100, offset: 1_000_000, count: 100 }).hasNext).toBe(false);
    expect(pageInfo({ total: 5_000_000, limit: 100, offset: 999_900, count: 100 }).hasNext).toBe(true);
  });
});

describe("formatJsonValue", () => {
  it("shows null/undefined as a dash", () => {
    expect(formatJsonValue(null)).toBe("—");
    expect(formatJsonValue(undefined)).toBe("—");
  });

  it("pretty-prints objects and arrays with 2-space indentation", () => {
    expect(formatJsonValue({ name: "Acme", isActive: false })).toBe('{\n  "name": "Acme",\n  "isActive": false\n}');
    expect(formatJsonValue([1, 2])).toBe("[\n  1,\n  2\n]");
  });

  it("returns markup inside values as plain text (rendered escaped, never as HTML)", () => {
    expect(formatJsonValue({ notes: "<img src=x onerror=alert(1)>" })).toBe('{\n  "notes": "<img src=x onerror=alert(1)>"\n}');
    expect(formatJsonValue("<b>raw</b>")).toBe("<b>raw</b>");
  });

  it("handles numbers, booleans and values JSON can't encode", () => {
    expect(formatJsonValue(0)).toBe("0");
    expect(formatJsonValue(false)).toBe("false");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(formatJsonValue(cyclic)).toBe("[object Object]");
  });
});

describe("audit-log API requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(data: unknown) {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data, error: null, meta: null }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("GET /api/v1/audit-logs with the built params, returning the page from inside data", async () => {
    const page = { logs: [], total: 0, limit: 20, offset: 0 };
    const fetchMock = stubFetch(page);
    await expect(fetchAuditLogs({ entity: "users", limit: 20, offset: 0 })).resolves.toEqual(page);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/v1/audit-logs?entity=users&limit=20&offset=0");
    expect(init?.method).toBe("GET");
  });

  it("GET /api/v1/audit-logs/:id → the log", async () => {
    const fetchMock = stubFetch({ log: { id: "a1" } });
    await expect(fetchAuditLog("a1")).resolves.toEqual({ id: "a1" });
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/v1/audit-logs/a1");
  });
});
