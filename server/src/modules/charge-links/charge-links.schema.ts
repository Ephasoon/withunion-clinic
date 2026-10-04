import { z } from "zod";

/**
 * PUT /charge-links — name is the medicine / lab test name as it appears
 * on the visit; the server normalizes it into the link's name_key.
 */
export const SaveChargeLinkSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(255),
    priceListItemId: z.string().uuid("priceListItemId must be a valid uuid"),
  })
  .strict();

export type SaveChargeLinkInput = z.infer<typeof SaveChargeLinkSchema>;
