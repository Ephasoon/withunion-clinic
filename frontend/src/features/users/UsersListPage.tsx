import { Link } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { EmptyState, ErrorState, LoadingState } from "../../components/QueryStates";
import { roleLabel } from "../../rbac/roles";
import { useUsers } from "./queries";

/** GET /users (owner): every user including inactive, by full name. */
export function UsersListPage() {
  const auth = useAuth();
  const currentUserId = auth.status === "authenticated" ? auth.user.id : null;
  const users = useUsers();

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Users</h1>
        <Link
          to="/users/new"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Add user
        </Link>
      </div>

      {users.isPending ? (
        <LoadingState label="Loading users…" />
      ) : users.isError ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : users.data.length === 0 ? (
        <EmptyState>No users yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Username</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.data.map((user) => (
                <tr key={user.id} className={user.isActive ? undefined : "text-slate-500"}>
                  <td className="px-4 py-2">
                    <Link to={`/users/${user.id}`} className="font-medium text-slate-900 hover:underline">
                      {user.fullName}
                    </Link>
                    {user.id === currentUserId && <span className="ml-2 text-xs text-slate-500">(you)</span>}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{user.username}</td>
                  <td className="px-4 py-2">{roleLabel(user.role)}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        user.isActive ? "bg-green-100 text-green-900" : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {user.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
