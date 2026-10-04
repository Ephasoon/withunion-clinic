import { api } from "../../api";
import type {
  BillingWorkItem,
  ChargeNameLink,
  InvoiceDetail,
  InvoiceItemBody,
  PaymentBody,
  SaveChargeLinkBody,
} from "./types";

const invoicePath = (invoiceId: string) => `/api/v1/billing/invoices/${encodeURIComponent(invoiceId)}`;

/**
 * GET /billing/invoices → { work } — reception only. Every visit currently
 * WAITING_FOR_BILLING (any date), oldest first; invoice null until created.
 */
export async function fetchBillingWork(signal?: AbortSignal): Promise<BillingWorkItem[]> {
  const { work } = await api.get<{ work: BillingWorkItem[] }>("/api/v1/billing/invoices", { signal });
  return work;
}

/** GET /billing/invoices/:id → { invoice } — reception, owner only (not open to every role). */
export async function fetchInvoice(invoiceId: string, signal?: AbortSignal): Promise<InvoiceDetail> {
  const { invoice } = await api.get<{ invoice: InvoiceDetail }>(invoicePath(invoiceId), { signal });
  return invoice;
}

/** GET /visits/:id/invoice → { invoice } — reception, owner; null when none has been created yet. */
export async function fetchVisitInvoice(visitId: string, signal?: AbortSignal): Promise<InvoiceDetail | null> {
  const { invoice } = await api.get<{ invoice: InvoiceDetail | null }>(
    `/api/v1/visits/${encodeURIComponent(visitId)}/invoice`,
    { signal }
  );
  return invoice;
}

/**
 * POST /billing/visits/:visitId/invoice (no body) → 201 { invoice }.
 * There is no way to set a discount; it is always 0.
 */
export async function createInvoice(visitId: string): Promise<InvoiceDetail> {
  const { invoice } = await api.post<{ invoice: InvoiceDetail }>(
    `/api/v1/billing/visits/${encodeURIComponent(visitId)}/invoice`
  );
  return invoice;
}

/** POST /billing/invoices/:id/items { items } → 201 { invoice }. Only while OPEN. */
export async function addInvoiceItems(invoiceId: string, items: InvoiceItemBody[]): Promise<InvoiceDetail> {
  const { invoice } = await api.post<{ invoice: InvoiceDetail }>(`${invoicePath(invoiceId)}/items`, { items });
  return invoice;
}

/** POST /billing/invoices/:id/payments { amount, method } → 201 { invoice }. */
export async function recordPayment(invoiceId: string, payment: PaymentBody): Promise<InvoiceDetail> {
  const { invoice } = await api.post<{ invoice: InvoiceDetail }>(`${invoicePath(invoiceId)}/payments`, {
    amount: payment.amount,
    method: payment.method,
  });
  return invoice;
}

/**
 * POST /billing/invoices/:id/complete (no body) → { invoice, visitStatus: "COMPLETED" }.
 * Marks the invoice PAID and the visit COMPLETED in one transaction. The only
 * way to complete a visit — the generic transition endpoint refuses COMPLETED.
 */
export async function completeBilling(invoiceId: string): Promise<{ invoice: InvoiceDetail; visitStatus: "COMPLETED" }> {
  return api.post<{ invoice: InvoiceDetail; visitStatus: "COMPLETED" }>(`${invoicePath(invoiceId)}/complete`);
}

/** GET /charge-links → { links } — reception, owner; every link, nameKey ASC, no pagination. */
export async function fetchChargeLinks(signal?: AbortSignal): Promise<ChargeNameLink[]> {
  const { links } = await api.get<{ links: ChargeNameLink[] }>("/api/v1/charge-links", { signal });
  return links;
}

/**
 * PUT /charge-links { name, priceListItemId } → 201 (created) / 200 (replaced) { link }.
 * The server normalizes the name; 409 PRICE_LIST_ITEM_INACTIVE for an inactive item.
 */
export async function saveChargeLink(body: SaveChargeLinkBody): Promise<ChargeNameLink> {
  const { link } = await api.put<{ link: ChargeNameLink }>("/api/v1/charge-links", {
    name: body.name,
    priceListItemId: body.priceListItemId,
  });
  return link;
}
