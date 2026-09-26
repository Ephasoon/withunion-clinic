import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { getReceipt, renderReceiptHtml } from "./receipts.service";
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

receiptsRouter.get(
  "/invoices/:invoiceId/print",
  requireAuth,
  requireRole(ROLES.RECEPTION, ROLES.OWNER),
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
