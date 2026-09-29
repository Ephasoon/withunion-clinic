import { Link } from "react-router";
import { EmptyState, ErrorState, LoadingState } from "../../components/QueryStates";
import { useSuppliers } from "./queries";
import { SupplierStatusBadge } from "./SupplierFields";

/** GET /suppliers (owner): every supplier including inactive, by name. */
export function SuppliersListPage() {
  const suppliers = useSuppliers();

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Suppliers</h1>
        <Link to="/suppliers/new" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
          Add supplier
        </Link>
      </div>

      {suppliers.isPending ? (
        <LoadingState label="Loading suppliers…" />
      ) : suppliers.isError ? (
        <ErrorState error={suppliers.error} onRetry={() => void suppliers.refetch()} />
      ) : suppliers.data.length === 0 ? (
        <EmptyState>No suppliers yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Contact</th>
                <th className="px-4 py-2">Phone</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {suppliers.data.map((s) => (
                <tr key={s.id} className={s.isActive ? undefined : "text-slate-500"}>
                  <td className="px-4 py-2">
                    <Link to={`/suppliers/${s.id}`} className="font-medium text-slate-900 hover:underline">
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{s.contactPerson || "—"}</td>
                  <td className="px-4 py-2">{s.phone || "—"}</td>
                  <td className="px-4 py-2">{s.email || "—"}</td>
                  <td className="px-4 py-2">
                    <SupplierStatusBadge isActive={s.isActive} />
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
