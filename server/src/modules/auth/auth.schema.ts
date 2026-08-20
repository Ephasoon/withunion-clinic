import { z } from "zod";

export const LoginSchema = z.object({
  username: z.string().min(1, "username is required").max(100),
  password: z.string().min(1, "password is required").max(200),
});

export type LoginInput = z.infer<typeof LoginSchema>;
