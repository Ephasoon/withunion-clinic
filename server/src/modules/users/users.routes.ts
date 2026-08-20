import { Router } from "express";
import { pool } from "../../config/db";
import { requireAuth, requireRole } from "../../middleware/auth";
import { ROLES } from "../roles/roles";

export const usersRouter = Router();

/**
 * Owner-only. Demonstrates the RBAC pattern the rest of the app
 * follows: requireAuth first, then requireRole/requirePermission.
 * Full user management (create/deactivate/reset password) is
 * implemented alongside the clinical modules in Phase 3, once the
 * foundation below is verified by tests.
 */
usersRouter.get("/", requireAuth, requireRole(ROLES.OWNER), async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.username, u.is_active, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id
       ORDER BY u.full_name`
    );
    res.json({ data: { users: result.rows }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});
