import { z } from "zod";
import { ALL_ROLES, Role } from "../roles/roles";

const RoleEnum = z.enum(ALL_ROLES as [Role, ...Role[]]);

export const CreateUserSchema = z
  .object({
    fullName: z.string().trim().min(1, "fullName is required").max(255),
    username: z
      .string()
      .trim()
      .min(1, "username is required")
      .max(100)
      .regex(/^[a-zA-Z0-9._-]+$/, "username may only contain letters, numbers, '.', '_', and '-'"),
    password: z.string().min(8, "password must be at least 8 characters").max(200),
    role: RoleEnum,
  })
  .strict();

export type CreateUserInput = z.infer<typeof CreateUserSchema>;

/**
 * At least one of fullName/role/isActive must be present — an empty
 * PATCH body is rejected rather than silently treated as a no-op.
 * No deletion field exists; deactivation is the only "removal" path.
 */
export const UpdateUserSchema = z
  .object({
    fullName: z.string().trim().min(1).max(255).optional(),
    role: RoleEnum.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((data) => data.fullName !== undefined || data.role !== undefined || data.isActive !== undefined, {
    message: "At least one of fullName, role, or isActive is required",
  });

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

export const ResetPasswordSchema = z
  .object({
    newPassword: z.string().min(8, "newPassword must be at least 8 characters").max(200),
  })
  .strict();

export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;
