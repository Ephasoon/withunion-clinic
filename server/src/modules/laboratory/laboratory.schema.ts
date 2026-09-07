import { z } from "zod";

const ResultEntrySchema = z.object({
  itemId: z.string().uuid("itemId must be a valid uuid"),
  result: z.string().trim().min(1, "result must not be empty").max(2000),
});

export const EnterResultsSchema = z
  .object({
    results: z.array(ResultEntrySchema).min(1, "at least one result is required").max(50),
  })
  .strict();

export type EnterResultsInput = z.infer<typeof EnterResultsSchema>;