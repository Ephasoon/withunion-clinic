import { ROLES } from "../../rbac/roles";
import type { LabOrderDetail } from "../doctor/types";
import type { VisitStatus } from "../visits/types";

export interface LabActions {
  /** POST /laboratory/orders/:id/start — visit WAITING_FOR_LAB → AT_LAB (never the generic transition). */
  canStart: boolean;
  /** POST /laboratory/orders/:id/results — visit AT_LAB and the order still REQUESTED. */
  canEnterResults: boolean;
  /** POST /laboratory/orders/:id/complete — visit AT_LAB and the order still REQUESTED. */
  canComplete: boolean;
}

const NONE: LabActions = { canStart: false, canEnterResults: false, canComplete: false };

/**
 * What a user with `role` may do on an order, from the visit's status
 * and the order's status (the backend's preconditions, docs §5.7). Only
 * lab technicians act; the owner and everyone else view only. A
 * COMPLETED order — closed by a finished lab round — allows nothing.
 */
export function allowedLabActions(
  role: string,
  visitStatus: VisitStatus,
  orderStatus: LabOrderDetail["status"]
): LabActions {
  if (role !== ROLES.LAB_TECH || orderStatus !== "REQUESTED") return NONE;
  if (visitStatus === "WAITING_FOR_LAB") return { ...NONE, canStart: true };
  if (visitStatus === "AT_LAB") return { canStart: false, canEnterResults: true, canComplete: true };
  return NONE;
}

export interface LabQueueGroup {
  visitId: string;
  patientCode: string;
  patientFullName: string;
  visitStatus: VisitStatus;
  /** The visit's outstanding orders, oldest first. */
  orders: LabOrderDetail[];
}

/**
 * GET /laboratory/orders grouped by visit. A visit can have several
 * outstanding orders (e.g. from two consultations), and starting or
 * completing works on the whole visit, so the queue shows one group per
 * visit. Groups and orders keep the API's order (requestedAt ASC).
 */
export function groupOrdersByVisit(orders: readonly LabOrderDetail[]): LabQueueGroup[] {
  const groups = new Map<string, LabQueueGroup>();
  for (const order of orders) {
    let group = groups.get(order.visitId);
    if (!group) {
      group = {
        visitId: order.visitId,
        patientCode: order.patientCode,
        patientFullName: order.patientFullName,
        visitStatus: order.visitStatus,
        orders: [],
      };
      groups.set(order.visitId, group);
    }
    group.orders.push(order);
  }
  return [...groups.values()];
}
