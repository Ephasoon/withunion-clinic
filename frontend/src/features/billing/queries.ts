import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { patientKeys } from "../patients/queries";
import { fetchReceipt } from "../receipts/api";
import { visitKeys } from "../visits/queries";
import {
  addInvoiceItems,
  completeBilling,
  createInvoice,
  fetchBillingWork,
  fetchChargeLinks,
  fetchInvoice,
  fetchVisitInvoice,
  recordPayment,
  saveChargeLink,
} from "./api";
import type { InvoiceDetail, InvoiceItemBody, PaymentBody, SaveChargeLinkBody } from "./types";

export const billingKeys = {
  work: ["billing", "work"] as const,
  invoice: (invoiceId: string) => ["billing", "invoice", invoiceId] as const,
  visitInvoice: (visitId: string) => ["billing", "visit-invoice", visitId] as const,
  receipt: (invoiceId: string) => ["billing", "receipt", invoiceId] as const,
  chargeLinks: ["billing", "charge-links"] as const,
};

export const BILLING_WORK_REFRESH_MS = 15_000;

export function useBillingWork() {
  return useQuery({
    queryKey: billingKeys.work,
    queryFn: ({ signal }) => fetchBillingWork(signal),
    refetchInterval: BILLING_WORK_REFRESH_MS,
    staleTime: 0,
  });
}

/** Load only once the visit has loaded. null = no invoice yet. */
export function useVisitInvoice(visitId: string, enabled: boolean) {
  return useQuery({
    queryKey: billingKeys.visitInvoice(visitId),
    queryFn: ({ signal }) => fetchVisitInvoice(visitId, signal),
    enabled,
  });
}

/** The invoice by id (GET /billing/invoices/:id) — the page's source of truth once it exists. */
export function useInvoice(invoiceId: string | null) {
  return useQuery({
    queryKey: billingKeys.invoice(invoiceId ?? ""),
    queryFn: ({ signal }) => fetchInvoice(invoiceId!, signal),
    enabled: invoiceId !== null,
  });
}

/** The JSON receipt — only requested for a PAID invoice. */
export function useReceipt(invoiceId: string, enabled: boolean) {
  return useQuery({
    queryKey: billingKeys.receipt(invoiceId),
    queryFn: ({ signal }) => fetchReceipt(invoiceId, signal),
    enabled,
  });
}

/**
 * After any billing action — success or failure: the work queue, the
 * invoice, the visit's invoice, the receipt, the visit, today's queue and
 * patient histories refetch. A returned invoice is written into the cache
 * straight away so totals update without waiting.
 */
function afterBillingChange(queryClient: QueryClient, visitId: string, invoice?: InvoiceDetail) {
  if (invoice) {
    queryClient.setQueryData(billingKeys.invoice(invoice.id), invoice);
    queryClient.setQueryData(billingKeys.visitInvoice(visitId), invoice);
  }
  void queryClient.invalidateQueries({ queryKey: billingKeys.work });
  void queryClient.invalidateQueries({ queryKey: ["billing", "invoice"] });
  void queryClient.invalidateQueries({ queryKey: billingKeys.visitInvoice(visitId) });
  void queryClient.invalidateQueries({ queryKey: ["billing", "receipt"] });
  void queryClient.invalidateQueries({ queryKey: visitKeys.detail(visitId) });
  void queryClient.invalidateQueries({ queryKey: visitKeys.today });
  void queryClient.invalidateQueries({ queryKey: [patientKeys.all[0], "visits"] });
}

export function useCreateInvoice(visitId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => createInvoice(visitId),
    onSettled: (invoice) => afterBillingChange(queryClient, visitId, invoice),
  });
}

/**
 * POST /billing/invoices/:id/items. Used by "Add charges" (through
 * useInvoiceMutations) and, as its own instance so its pending/error
 * state stays separate, by "Suggested charges" — the same request either way.
 */
export function useAddInvoiceItems(invoiceId: string, visitId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (items: InvoiceItemBody[]) => addInvoiceItems(invoiceId, items),
    onSettled: (invoice) => afterBillingChange(queryClient, visitId, invoice),
  });
}

export function useInvoiceMutations(invoiceId: string, visitId: string) {
  const queryClient = useQueryClient();
  const addItems = useAddInvoiceItems(invoiceId, visitId);
  const pay = useMutation({
    mutationFn: (payment: PaymentBody) => recordPayment(invoiceId, payment),
    onSettled: (invoice) => afterBillingChange(queryClient, visitId, invoice),
  });
  const complete = useMutation({
    mutationFn: () => completeBilling(invoiceId),
    onSettled: (result) => afterBillingChange(queryClient, visitId, result?.invoice),
  });
  return { addItems, pay, complete };
}

/** Saved name → price-list item links (GET /charge-links), for the invoice page's suggestions. */
export function useChargeLinks(enabled: boolean) {
  return useQuery({
    queryKey: billingKeys.chargeLinks,
    queryFn: ({ signal }) => fetchChargeLinks(signal),
    enabled,
  });
}

/** PUT /charge-links. The links refetch afterwards — success or failure — so suggestions show the saved state. */
export function useSaveChargeLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveChargeLinkBody) => saveChargeLink(body),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: billingKeys.chargeLinks }),
  });
}
