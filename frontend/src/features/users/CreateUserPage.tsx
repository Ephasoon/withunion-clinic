import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { validationDetails } from "../../api";
import { ALL_ROLES, ROLE_LABELS, type Role } from "../../rbac/roles";
import { useCreateUser } from "./queries";
import { userErrorMessage } from "./userErrors";
import {
  FULL_NAME_MAX,
  PASSWORD_MAX,
  USERNAME_MAX,
  validateCreateUser,
  type CreateUserErrors,
  type CreateUserValues,
} from "./userRules";

const inputClass =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none aria-[invalid=true]:border-red-500";

const EMPTY: CreateUserValues = { fullName: "", username: "", password: "", role: "" };

/** POST /users. The password is cleared as soon as it is submitted and is never shown back. */
export function CreateUserPage() {
  const navigate = useNavigate();
  const create = useCreateUser();
  const [values, setValues] = useState<CreateUserValues>(EMPTY);
  const [errors, setErrors] = useState<CreateUserErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const set = (field: keyof CreateUserValues, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
    setServerError(null);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (create.isPending) return;
    const result = validateCreateUser(values);
    if (!result.ok) return setErrors(result.errors);
    const submittedPassword = result.body.password;
    setValues((v) => ({ ...v, password: "" }));
    create.mutate(result.body, {
      onSuccess: (user) => navigate(`/users/${user.id}`, { replace: true }),
      onError: (error) => {
        const details = validationDetails(error);
        setErrors({ fullName: details?.fullName?.[0], username: details?.username?.[0], role: details?.role?.[0] });
        setServerError(userErrorMessage(error, "create", [submittedPassword]));
      },
    });
  };

  return (
    <section className="mx-auto max-w-lg space-y-4">
      <div>
        <Link to="/users" className="text-sm text-slate-600 hover:underline">
          ← Users
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Add user</h1>
      </div>
      <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
        {serverError && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {serverError}
          </p>
        )}
        <div>
          <label htmlFor="user-fullName" className="text-sm font-medium text-slate-700">
            Full name
          </label>
          <input id="user-fullName" maxLength={FULL_NAME_MAX} value={values.fullName} onChange={(e) => set("fullName", e.target.value)} aria-invalid={errors.fullName ? true : undefined} className={inputClass} />
          {errors.fullName && <p className="mt-1 text-xs text-red-700">{errors.fullName}</p>}
        </div>
        <div>
          <label htmlFor="user-username" className="text-sm font-medium text-slate-700">
            Username
          </label>
          <input id="user-username" autoComplete="off" maxLength={USERNAME_MAX} value={values.username} onChange={(e) => set("username", e.target.value)} aria-invalid={errors.username ? true : undefined} className={inputClass} />
          <p className={`mt-1 text-xs ${errors.username ? "text-red-700" : "text-slate-500"}`}>
            {errors.username ?? "Letters, numbers, dots, underscores and hyphens only."}
          </p>
        </div>
        <div>
          <label htmlFor="user-password" className="text-sm font-medium text-slate-700">
            Initial password
          </label>
          <input id="user-password" type="password" autoComplete="new-password" maxLength={PASSWORD_MAX} value={values.password} onChange={(e) => set("password", e.target.value)} aria-invalid={errors.password ? true : undefined} className={inputClass} />
          <p className={`mt-1 text-xs ${errors.password ? "text-red-700" : "text-slate-500"}`}>
            {errors.password ?? "At least 8 characters. Give it to the user privately."}
          </p>
        </div>
        <div>
          <label htmlFor="user-role" className="text-sm font-medium text-slate-700">
            Role
          </label>
          <select id="user-role" value={values.role} onChange={(e) => set("role", e.target.value as Role | "")} aria-invalid={errors.role ? true : undefined} className={inputClass}>
            <option value="">Choose…</option>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          {errors.role && <p className="mt-1 text-xs text-red-700">{errors.role}</p>}
        </div>
        <button type="submit" disabled={create.isPending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {create.isPending ? "Adding…" : "Add user"}
        </button>
      </form>
    </section>
  );
}
