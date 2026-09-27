import { Router } from "express";
import helmet from "helmet";
import { requireAuth, requireRole } from "../../middleware/auth";
import { getReceipt, renderReceiptHtml, PRINT_SCRIPT_CSP_HASH } from "./receipts.service";
import { AppError } from "../../utils/appError";
import { ROLES } from "../roles/roles";

export const receiptsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuidParam(value: string, label = "id") {
  if (!UUID_RE.test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", `Invalid ${label} format`);
  }
}

receiptsRouter.get(
  "/invoices/:invoiceId",
  requireAuth,
  requireRole(ROLES.RECEPTION, ROLES.OWNER),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.invoiceId, "invoiceId");
      const receipt = await getReceipt(req.params.invoiceId);
      res.json({ data: { receipt }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Route-scoped CSP: helmet's default directives (useDefaults), with
 * script-src extended by the hash of the page's single inline
 * window.print() script. Overwrites the app-wide CSP header for this
 * response only; every other route keeps plain script-src 'self'.
 */
const printPageCsp = helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: { "script-src": ["'self'", `'${PRINT_SCRIPT_CSP_HASH}'`] },
});

receiptsRouter.get(
  "/invoices/:invoiceId/print",
  requireAuth,
  requireRole(ROLES.RECEPTION, ROLES.OWNER),
  printPageCsp,
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.invoiceId, "invoiceId");
      const receipt = await getReceipt(req.params.invoiceId);
      res.set("Content-Type", "text/html; charset=utf-8");
      res.send(renderReceiptHtml(receipt));
    } catch (err) {
      next(err);
    }
  }
);
