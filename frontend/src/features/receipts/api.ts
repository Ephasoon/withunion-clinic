import { api, apiUrl } from "../../api";
import type { Receipt } from "./types";

const receiptPath = (invoiceId: string) => `/api/v1/receipts/invoices/${encodeURIComponent(invoiceId)}`;

/** GET /receipts/invoices/:invoiceId → { receipt } — reception, owner; 409 until the invoice is PAID. */
export async function fetchReceipt(invoiceId: string, signal?: AbortSignal): Promise<Receipt> {
  const { receipt } = await api.get<{ receipt: Receipt }>(receiptPath(invoiceId), { signal });
  return receipt;
}

/**
 * The full URL of the printable receipt page (GET …/print), built with
 * apiUrl() so VITE_API_BASE_URL is respected.
 */
export function receiptPrintUrl(invoiceId: string): string {
  return apiUrl(`${receiptPath(invoiceId)}/print`);
}

/**
 * Opens the printable receipt as a real top-level page in a new tab —
 * never fetched and rendered inline. As a top-level navigation the session
 * cookie is sent, and the page's own auto-print script runs under the
 * route's scoped CSP hash (docs §5.11). `open` is injectable for tests.
 */
export function openReceiptPrint(
  invoiceId: string,
  open: (url: string, target: string) => unknown = (url, target) => window.open(url, target)
): void {
  open(receiptPrintUrl(invoiceId), "_blank");
}
