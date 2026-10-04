import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { SaveChargeLinkSchema } from "./charge-links.schema";
import { listChargeNameLinks, saveChargeNameLink } from "./charge-links.service";
import { recordAudit } from "../../utils/audit";
import { ROLES } from "../roles/roles";

export const chargeLinksRouter = Router();

// Owner + Reception — the same roles that read the price list. Reception
// saves links while billing; there is no delete endpoint in this version.
chargeLinksRouter.get("/", requireAuth, requireRole(ROLES.OWNER, ROLES.RECEPTION), async (_req, res, next) => {
  try {
    const links = await listChargeNameLinks();
    res.json({ data: { links }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// Upsert by normalized name: 201 when a link was created, 200 when an
// existing one was replaced. Audited either way, with before (null on
// create) and after.
chargeLinksRouter.put(
  "/",
  requireAuth,
  requireRole(ROLES.OWNER, ROLES.RECEPTION),
  validateBody(SaveChargeLinkSchema),
  async (req, res, next) => {
    try {
      const { link, before, created } = await saveChargeNameLink(req.body, req.session.user!.id);
      await recordAudit({
        userId: req.session.user!.id,
        action: "charge_link.save",
        entity: "charge_name_links",
        entityId: link.id,
        beforeValue: before,
        afterValue: link,
        ipAddress: req.ip,
      });
      res.status(created ? 201 : 200).json({ data: { link }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);
