import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { ErrorState, LoadingState } from "../../components/QueryStates";
import { formatDateTime } from "../../lib/dates";
import { ALL_ROLES, ROLE_LABELS, roleLabel, type Role } from "../../rbac/roles";
import { useResetPassword, useUpdateUser, useUser, useUsers } from "./queries";
import type { User } from "./types";
import { userErrorMessage } from "./userErrors";
import {
  buildUserPatch,
  changeEndsSessions,
  editConstraints,
  FULL_NAME_MAX,
  PASSWORD_MAX,
  validatePassword,
  type EditConstraints,
} from "./userRules";

const inputClass =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-100 aria-[invalid=true]:border-red-500";

/** PATCH /users/:id — only changed fields; self and last-owner limits applied before submitting. */
function EditUserForm({ user, constraints }: { user: User; constraints: EditConstraints }) {
  const update = useUpdateUser(user.id);
  const [fullName, setFullName] = useState(user.fullName);
  const [role, setRole] = useState<Role>(user.role);
  const [isActive, setIsActive] = useState(user.isActive);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const touch = () => {
    setError(null);
    setSavedNote(null);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (update.isPending) return;
    const patch = buildUserPatch(user, { fullName, role, isActive });
    if (!patch.ok) return setError(patch.error);
    const endsSessions = changeEndsSessions(user, patch.body);
    update.mutate(patch.body, {
      onSuccess: () =>
        setSavedNote(
          endsSessions
            ? "Saved. The user has been signed out everywhere and must sign in again."
            : constraints.isSelf && patch.body.fullName
              ? "Saved. Your name in the top bar updates the next time you sign in."
              : "Saved."
        ),
      onError: (e) => setError(userErrorMessage(e, "update")),
    });
  };

  const deactivateDisabled = isActive && constraints.deactivateBlockedReason !== null;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">Details</h2>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {savedNote && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
          {savedNote}
        </p>
      )}
      <div>
        <label htmlFor="edit-fullName" className="text-sm font-medium text-slate-700">
          Full name
        </label>
        <input id="edit-fullName" maxLength={FULL_NAME_MAX} value={fullName} onChange={(e) => { setFullName(e.target.value); touch(); }} className={inputClass} />
      </div>
      <div>
        <label htmlFor="edit-role" className="text-sm font-medium text-slate-700">
          Role
        </label>
        <select id="edit-role" value={role} onChange={(e) => { setRole(e.target.value as Role); touch(); }} className={inputClass}>
          {ALL_ROLES.map((r) => (
            <option key={r} value={r} disabled={!constraints.allowedRoles.includes(r)}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        {constraints.roleBlockedReason && <p className="mt-1 text-xs text-slate-500">{constraints.roleBlockedReason}</p>}
      </div>
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={isActive}
            disabled={deactivateDisabled}
            onChange={(e) => { setIsActive(e.target.checked); touch(); }}
          />
          Active (can sign in)
        </label>
        {deactivateDisabled && <p className="mt-1 text-xs text-slate-500">{constraints.deactivateBlockedReason}</p>}
      </div>
      <p className="text-xs text-slate-500">Changing the role or deactivating signs the user out everywhere.</p>
      <button type="submit" disabled={update.isPending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        {update.isPending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

/**
 * POST /users/:id/reset-password. Always warns that it ends the target's
 * sessions; for your OWN account it warns that you will be signed out,
 * asks for a second click, and signs the app out on success.
 */
function ResetPasswordForm({ user, isSelf }: { user: User; isSelf: boolean }) {
  const reset = useResetPassword(user.id, isSelf);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (reset.isPending) return;
    const invalid = validatePassword(password);
    if (invalid) return setError(invalid);
    if (password !== confirm) return setError("The two passwords don’t match.");
    if (isSelf && !confirming) return setConfirming(true);
    const submitted = password;
    setPassword("");
    setConfirm("");
    setConfirming(false);
    reset.mutate(submitted, {
      onSuccess: () => setDone(true),
      onError: (e) => setError(userErrorMessage(e, "reset-password", [submitted])),
    });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">Reset password</h2>
      <p role="note" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
        {isSelf
          ? "This is your own account: resetting the password signs you out of this app immediately, on every device. You will need the new password to sign back in."
          : `Resetting the password signs ${user.fullName} out everywhere. They will need the new password to sign in.`}
      </p>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
          Password reset. {user.fullName} has been signed out and must use the new password.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="reset-password" className="text-sm font-medium text-slate-700">
            New password
          </label>
          <input id="reset-password" type="password" autoComplete="new-password" maxLength={PASSWORD_MAX} value={password} onChange={(e) => { setPassword(e.target.value); setError(null); setConfirming(false); setDone(false); }} className={inputClass} />
        </div>
        <div>
          <label htmlFor="reset-confirm" className="text-sm font-medium text-slate-700">
            Repeat new password
          </label>
          <input id="reset-confirm" type="password" autoComplete="new-password" maxLength={PASSWORD_MAX} value={confirm} onChange={(e) => { setConfirm(e.target.value); setError(null); setConfirming(false); }} className={inputClass} />
        </div>
      </div>
      <p className="text-xs text-slate-500">At least 8 characters.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={reset.isPending}
          className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
            confirming ? "bg-red-700 hover:bg-red-800" : "bg-slate-900 hover:bg-slate-700"
          }`}
        >
          {reset.isPending ? "Resetting…" : confirming ? "Yes, reset my password and sign me out" : "Reset password"}
        </button>
        {confirming && (
          <button type="button" onClick={() => setConfirming(false)} className="text-sm text-slate-600 hover:underline">
            Don’t reset
          </button>
        )}
      </div>
    </form>
  );
}

/** GET /users/:id plus GET /users (needed to count the other active owners). */
export function UserDetailPage() {
  const { userId = "" } = useParams();
  const auth = useAuth();
  const currentUserId = auth.status === "authenticated" ? auth.user.id : "";
  const userQuery = useUser(userId);
  const usersQuery = useUsers();

  if (userQuery.isPending || usersQuery.isPending) return <LoadingState label="Loading user…" />;
  if (userQuery.isError) {
    return <ErrorState error={userQuery.error} notFound="This user does not exist." onRetry={() => void userQuery.refetch()} />;
  }
  if (usersQuery.isError) return <ErrorState error={usersQuery.error} onRetry={() => void usersQuery.refetch()} />;

  const user = userQuery.data;
  const constraints = editConstraints(currentUserId, user, usersQuery.data);

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link to="/users" className="text-sm text-slate-600 hover:underline">
          ← Users
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">{user.fullName}</h1>
          {constraints.isSelf && <span className="text-sm text-slate-500">(you)</span>}
          <span className="font-mono text-sm text-slate-600">{user.username}</span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {roleLabel(user.role)} · {user.isActive ? "Active" : "Inactive"} · added {formatDateTime(user.createdAt)}
        </p>
      </div>

      {/* Keyed by user id only: after a save the draft already equals the saved values, and the "Saved" note stays visible. */}
      <EditUserForm key={user.id} user={user} constraints={constraints} />
      <ResetPasswordForm user={user} isSelf={constraints.isSelf} />
    </section>
  );
}
