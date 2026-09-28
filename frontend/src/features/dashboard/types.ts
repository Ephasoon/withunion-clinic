/**
 * GET /api/v1/dashboard — `data` IS this snapshot, not `{ dashboard: … }`
 * (docs §5.13, and DashboardSnapshot in server/src/modules/dashboard/dashboard.service.ts).
 * "Today" is the database's CURRENT_DATE. Every value is a number, never null.
 */
export interface DashboardSnapshot {
  generatedAt: string;
  patients: { registeredToday: number };
  visits: {
    today: number;
    completedToday: number;
    cancelledToday: number;
    /** Every non-terminal status (all 11, 0 if none) → how many visits are in it NOW, whatever day they started. */
    byStatus: Record<string, number>;
  };
  billing: {
    revenueToday: number;
    paymentsToday: number;
    openInvoiceCount: number;
    totalOutstandingBalance: number;
  };
  inventory: { totalItems: number; outOfStockCount: number };
  /** All 6 roles present. */
  staff: { activeByRole: Record<string, number>; totalActive: number };
}
