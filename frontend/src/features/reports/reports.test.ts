import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiUrl } from "../../api";
import { fetchReport } from "./api";
import {
  addDaysIso,
  defaultDateRange,
  getSessionRange,
  resetSessionRange,
  setSessionRange,
  validateDateRange,
} from "./dateRange";
import { reportErrorMessage } from "./reportErrors";
import {
  financialReportParams,
  pharmacyDispensingReportParams,
  purchasingReportParams,
  validateSupplierId,
  visitsReportParams,
} from "./reportParams";

const RANGE = { dateFrom: "2026-09-01", dateTo: "2026-09-28" };
const NO_RANGE = { dateFrom: "", dateTo: "" };
const SUPPLIER = "11111111-1111-4111-8111-111111111111";

describe("default date range (today − 29 days … today)", () => {
  it("covers 30 inclusive days ending today", () => {
    expect(defaultDateRange("2026-09-28")).toEqual({ dateFrom: "2026-08-30", dateTo: "2026-09-28" });
  });

  it("crosses month, year and leap-day boundaries correctly", () => {
    expect(defaultDateRange("2026-01-10")).toEqual({ dateFrom: "2025-12-12", dateTo: "2026-01-10" });
    expect(addDaysIso("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDaysIso("2023-03-01", -1)).toBe("2023-02-28");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("validateDateRange", () => {
  it("accepts a normal range, a single day, one side blank, or both blank", () => {
    expect(validateDateRange(RANGE).ok).toBe(true);
    expect(validateDateRange({ dateFrom: "2026-09-28", dateTo: "2026-09-28" }).ok).toBe(true);
    expect(validateDateRange({ dateFrom: "2026-09-01", dateTo: "" }).ok).toBe(true);
    expect(validateDateRange(NO_RANGE).ok).toBe(true);
  });

  it("refuses dateFrom after dateTo, reporting it on dateFrom like the backend's refine", () => {
    const result = validateDateRange({ dateFrom: "2026-09-29", dateTo: "2026-09-28" });
    expect(result).toEqual({ ok: false, errors: { dateFrom: "The start date must not be after the end date." } });
  });

  it("refuses impossible or malformed dates", () => {
    const result = validateDateRange({ dateFrom: "2026-02-30", dateTo: "28/09/2026" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["dateFrom", "dateTo"]);
  });
});

describe("session range (in memory only)", () => {
  beforeEach(() => resetSessionRange());

  it("defaults, then remembers the last range run", () => {
    expect(getSessionRange("2026-09-28")).toEqual({ dateFrom: "2026-08-30", dateTo: "2026-09-28" });
    setSessionRange({ dateFrom: " 2026-09-01 ", dateTo: "2026-09-15" });
    expect(getSessionRange("2026-09-28")).toEqual({ dateFrom: "2026-09-01", dateTo: "2026-09-15" });
  });
});

describe("report query-param builders — unset filters are omitted, not sent empty", () => {
  it("visits: status only when chosen", () => {
    expect(visitsReportParams(RANGE, { status: "" })).toEqual(RANGE);
    expect(visitsReportParams(RANGE, { status: "WITH_DOCTOR" })).toEqual({ ...RANGE, status: "WITH_DOCTOR" });
    expect(visitsReportParams(NO_RANGE, { status: "" })).toEqual({});
  });

  it("financial: groupBy always, dates only when set", () => {
    expect(financialReportParams(RANGE, { groupBy: "month" })).toEqual({ ...RANGE, groupBy: "month" });
    expect(financialReportParams(NO_RANGE, { groupBy: "day" })).toEqual({ groupBy: "day" });
  });

  it("purchasing: supplierId (trimmed) and status only when set", () => {
    expect(purchasingReportParams(RANGE, { supplierId: "  ", status: "" })).toEqual(RANGE);
    expect(purchasingReportParams(RANGE, { supplierId: ` ${SUPPLIER} `, status: "RECEIVED" })).toEqual({
      ...RANGE,
      supplierId: SUPPLIER,
      status: "RECEIVED",
    });
  });

  it("pharmacy-dispensing: status only when chosen", () => {
    expect(pharmacyDispensingReportParams(RANGE, { status: "" })).toEqual(RANGE);
    expect(pharmacyDispensingReportParams(RANGE, { status: "DISPENSED" })).toEqual({ ...RANGE, status: "DISPENSED" });
  });

  it("produces the expected query strings", () => {
    expect(apiUrl("/api/v1/reports/visits", visitsReportParams(NO_RANGE, { status: "" }))).toBe("/api/v1/reports/visits");
    expect(apiUrl("/api/v1/reports/financial", financialReportParams(RANGE, { groupBy: "day" }))).toBe(
      "/api/v1/reports/financial?dateFrom=2026-09-01&dateTo=2026-09-28&groupBy=day"
    );
  });

  it("validates the free-text supplier id", () => {
    expect(validateSupplierId("")).toBeNull();
    expect(validateSupplierId(SUPPLIER)).toBeNull();
    expect(validateSupplierId("acme")).toMatch(/UUID/);
  });
});

describe("reportErrorMessage", () => {
  it("shows the backend's specific field messages for VALIDATION_ERROR", () => {
    const error = new ApiError(400, "VALIDATION_ERROR", "Invalid query parameters", {
      dateFrom: ["dateFrom must not be after dateTo"],
    });
    expect(reportErrorMessage(error)).toBe("Start date: dateFrom must not be after dateTo");
  });

  it("falls back to the message when there are no field details", () => {
    expect(reportErrorMessage(new ApiError(400, "VALIDATION_ERROR", "Invalid query parameters", {}))).toBe(
      "Invalid query parameters"
    );
  });

  it("uses describeApiError for every other code", () => {
    expect(reportErrorMessage(new ApiError(403, "FORBIDDEN", "x"))).toMatch(/not allowed/);
    expect(reportErrorMessage(new ApiError(0, "NETWORK_ERROR", "x"))).toMatch(/reach the server/);
  });
});

describe("fetchReport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("GETs /api/v1/reports/:type with the built params and reads the report key", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { report: { totalCount: 3 } }, error: null, meta: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const report = await fetchReport("pharmacy-dispensing", pharmacyDispensingReportParams(RANGE, { status: "" }));
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "/api/v1/reports/pharmacy-dispensing?dateFrom=2026-09-01&dateTo=2026-09-28"
    );
    expect(report).toEqual({ totalCount: 3 });
  });
});
