import type { LabOrderDetail } from "../doctor/types";

export interface MissingTest {
  orderId: string;
  testName: string;
}

export interface MissingByOrder {
  orderId: string;
  requestedAt: string;
  testNames: string[];
}

/** A result counts as present only when it is non-blank — the backend's own check (docs §5.7). */
function hasResult(result: string | null): boolean {
  return result !== null && result.trim() !== "";
}

/**
 * Every test still without a result across all REQUESTED orders on the
 * visit. Completing any one order completes the whole round, and the
 * backend refuses while this list is non-empty. COMPLETED orders from an
 * earlier round are not part of the round and are ignored.
 */
export function missingResults(visitOrders: readonly LabOrderDetail[]): MissingByOrder[] {
  return visitOrders
    .filter((order) => order.status === "REQUESTED")
    .map((order) => ({
      orderId: order.id,
      requestedAt: order.requestedAt,
      testNames: order.items.filter((item) => !hasResult(item.result)).map((item) => item.testName),
    }))
    .filter((entry) => entry.testNames.length > 0);
}

/** The REQUESTED orders that completing will close, i.e. the current lab round. */
export function ordersInRound(visitOrders: readonly LabOrderDetail[]): LabOrderDetail[] {
  return visitOrders.filter((order) => order.status === "REQUESTED");
}

const PREFIX = "Cannot complete: missing results for ";
const OTHER_ORDER = /^(.+) \(order ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)$/i;

/**
 * Parses an INCOMPLETE_RESULTS message:
 *   "Cannot complete: missing results for CBC, Malaria RDT (order <uuid>)"
 * Tests on the order being completed are bare names; tests on the
 * visit's other outstanding orders are suffixed " (order <id>)".
 *
 * Returns null — so the caller shows the raw message — when the format
 * is unexpected. Names are joined with ", ", so a test name containing
 * ", " would split wrongly; passing `knownTests` (the round's loaded
 * tests) rejects any parse whose names don't all match a real test.
 */
export function parseIncompleteResults(
  message: string,
  completingOrderId: string,
  knownTests?: readonly MissingTest[]
): MissingTest[] | null {
  if (!message.startsWith(PREFIX)) return null;
  const list = message.slice(PREFIX.length).trim();
  if (list === "") return null;

  const parsed: MissingTest[] = [];
  for (const part of list.split(", ")) {
    const name = part.trim();
    if (name === "") return null;
    const other = OTHER_ORDER.exec(name);
    parsed.push(other ? { testName: other[1]!, orderId: other[2]! } : { testName: name, orderId: completingOrderId });
  }

  if (knownTests) {
    const known = new Set(knownTests.map((t) => `${t.orderId}\u0000${t.testName}`));
    if (!parsed.every((t) => known.has(`${t.orderId}\u0000${t.testName}`))) return null;
  }
  return parsed;
}
