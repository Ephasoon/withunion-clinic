import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { AddInvoiceItemsSchema, RecordPaymentSchema } from "./billing.schema";
import {
  listBillingWork,
  getInvoiceDetail,
  createInvoice,
  addInvoiceItems,
  recordPayment,
  completeBilling,
} from "./billing.service";
import { AppError } from "../../utils/appError";
import { recordAudit } from "../../utils/audit";
import { ROLES } from "../roles/roles";

export const billingRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuidParam(value: string, label = "id") {
  if (!UUID_RE.test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid " + label + " format");
  }
}

billingRouter.get("/invoices", requireAuth, requireRole(ROLES.RECEPTION), async (_req, res, next) => {
  try {
    const work = await listBillingWork();
    res.json({ data: { work }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

billingRouter.get("/invoices/:id", requireAuth, async (req, res, next) => {
  try {
    requireUuidParam(req.params.id);
    const invoice = await getInvoiceDetail(req.params.id);
    if (!invoice) {
      throw new AppError(404, "NOT_FOUND", "Invoice not found");
    }
    res.json({ data: { invoice }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

billingRouter.post(
  "/visits/:visitId/invoice",
  requireAuth,
  requireRole(ROLES.RECEPTION),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.visitId, "visit id");
      const invoice = await createInvoice(req.params.visitId, req.session.user!.id);

      await recordAudit({
        userId: req.session.user!.id,
        action: "invoice.create",
        entity: "invoices",
        entityId: invoice.id,
        afterValue: { visitId: invoice.visitId, discount: invoice.discount },
        ipAddress: req.ip,
      });

      res.status(201).json({ data: { invoice }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

billingRouter.post(
  "/invoices/:id/items",
  requireAuth,
  requireRole(ROLES.RECEPTION),
  validateBody(AddInvoiceItemsSchema),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id);
      const invoice = await addInvoiceItems(req.params.id, req.body);

      await recordAudit({
        userId: req.session.user!.id,
        action: "invoice_item.add",
        entity: "invoices",
        entityId: req.params.id,
        afterValue: { itemsAdded: req.body.items.length },
        ipAddress: req.ip,
      });

      res.status(201).json({ data: { invoice }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

billingRouter.post(
  "/invoices/:id/payments",
  requireAuth,
  requireRole(ROLES.RECEPTION),
  validateBody(RecordPaymentSchema),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id);
      const invoice = await recordPayment(req.params.id, req.session.user!.id, req.body);

      await recordAudit({
        userId: req.session.user!.id,
        action: "payment.record",
        entity: "invoices",
        entityId: req.params.id,
        afterValue: { amount: req.body.amount, method: req.body.method, balanceAfter: invoice.balance },
        ipAddress: req.ip,
      });

      res.status(201).json({ data: { invoice }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

billingRouter.post(
  "/invoices/:id/complete",
  requireAuth,
  requireRole(ROLES.RECEPTION),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id);
      const { invoice, visitStatus } = await completeBilling(req.params.id, req.session.user!.id);

      await recordAudit({
        userId: req.session.user!.id,
        action: "billing.complete",
        entity: "invoices",
        entityId: req.params.id,
        afterValue: { status: invoice.status },
        ipAddress: req.ip,
      });
      await recordAudit({
        userId: req.session.user!.id,
        action: "visit.transition",
        entity: "visits",
        entityId: invoice.visitId,
        beforeValue: { status: "WAITING_FOR_BILLING" },
        afterValue: { status: "COMPLETED", reason: null },
        ipAddress: req.ip,
      });

      res.json({ data: { invoice, visitStatus }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);
