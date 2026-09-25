import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { getDashboardSnapshot } from "./dashboard.service";
import { ROLES } from "../roles/roles";

export const dashboardRouter = Router();

// Owner-only, per the approved decision — consistent with every
// prior module's default choice over the unused VIEW_DASHBOARD
// permission. No request body, no query parameters, so no schema
// file is needed for this endpoint.
dashboardRouter.get("/", requireAuth, requireRole(ROLES.OWNER), async (_req, res, next) => {
  try {
    const snapshot = await getDashboardSnapshot();
    res.json({ data: snapshot, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});
