import type { Role } from "../../rbac/roles";

/** docs/api-inventory.md §4 User. Never includes the password or its hash. */
export interface User {
  id: string;
  fullName: string;
  username: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Body of POST /users. Strict on the backend: only these keys. */
export interface CreateUserBody {
  fullName: string;
  username: string;
  password: string;
  role: Role;
}

/** Body of PATCH /users/:id — only the fields that change; at least one. */
export interface UpdateUserBody {
  fullName?: string;
  role?: Role;
  isActive?: boolean;
}
