import { describe, expect, it } from "vitest";
import type { LabOrderDetail, PrescriptionDetail, PrescriptionItemStatus } from "../doctor/types";
import type { PriceListItem } from "../priceList/types";
import {
  addAllItems,
  buildChargeSuggestions,
  normalizeChargeName,
  suggestionToInvoiceItem,
  type SuggestionInput,
} from "./chargeSuggestions";
import type { ChargeNameLink } from "./types";

function priceItem(id: string, name: string, price: number, isActive = true): PriceListItem {
  return { id, name, price, isActive, createdBy: "u", createdAt: "", updatedAt: "" };
}

function link(nameKey: string, priceListItemId: string): ChargeNameLink {
  return { id: `link-${nameKey}`, nameKey, priceListItemId, createdBy: "u", createdAt: "" };
}

function prescription(
  items: Array<{ name: string; status: PrescriptionItemStatus; prescribed?: number; dispensed?: number | null }>
): PrescriptionDetail {
  return {
    id: `rx-${Math.random()}`,
    visitId: "v1",
    consultationId: "c1",
    doctorId: "d1",
    doctorName: "Dr",
    visitStatus: "WAITING_FOR_BILLING",
    patientCode: "P1",
    patientFullName: "Patient",
    createdAt: "",
    items: items.map((item, i) => ({
      id: `item-${i}-${Math.random()}`,
      medicineName: item.name,
      strength: null,
      dosage: null,
      frequency: null,
      duration: null,
      quantityPrescribed: item.prescribed ?? null,
      quantityDispensed: item.dispensed ?? null,
      status: item.status,
      inventoryItemId: null,
      dispensedBy: null,
      dispensedAt: null,
    })),
  };
}

function labOrder(status: LabOrderDetail["status"], tests: string[]): LabOrderDetail {
  return {
    id: `lab-${Math.random()}`,
    visitId: "v1",
    consultationId: "c1",
    requestedBy: "d1",
    requestedByName: "Dr",
    status,
    requestedAt: "",
    visitStatus: "WAITING_FOR_BILLING",
    patientCode: "P1",
    patientFullName: "Patient",
    items: tests.map((testName, i) => ({
      id: `t-${i}`,
      testName,
      result: status === "COMPLETED" ? "ok" : null,
      resultEnteredBy: null,
      resultEnteredAt: null,
    })),
  };
}

function build(partial: Partial<SuggestionInput>) {
  return buildChargeSuggestions({ prescriptions: [], labOrders: [], priceList: [], links: [], invoiceItems: [], ...partial });
}

const PARACETAMOL = priceItem("p-para", "Paracetamol 500mg", 2.5);
const AMOXICILLIN = priceItem("p-amox", "Amoxicillin", 12.3);
const FBC = priceItem("p-fbc", "Full Blood Count", 450);

describe("normalizeChargeName (same rules as the server)", () => {
  it("lowercases, trims and collapses whitespace, unicode spaces included", () => {
    expect(normalizeChargeName("  Full   Blood\tCOUNT ")).toBe("full blood count");
    expect(normalizeChargeName(" Malaria RDT　")).toBe("malaria rdt");
  });

  it("is not fuzzy", () => {
    expect(normalizeChargeName("X-ray")).not.toBe(normalizeChargeName("X ray"));
  });
});

describe("buildChargeSuggestions — what gets suggested", () => {
  it("a DISPENSED medicine is suggested at the quantity dispensed", () => {
    const rows = build({ prescriptions: [prescription([{ name: "Amoxicillin", status: "DISPENSED", prescribed: 21, dispensed: 21 }])] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "medicine:amoxicillin", kind: "medicine", name: "Amoxicillin", quantity: 21 });
  });

  it("a PARTIALLY_DISPENSED medicine uses the dispensed quantity, not the prescribed one", () => {
    const rows = build({
      prescriptions: [prescription([{ name: "Paracetamol 500mg", status: "PARTIALLY_DISPENSED", prescribed: 20, dispensed: 8 }])],
      priceList: [PARACETAMOL],
      links: [link("paracetamol 500mg", PARACETAMOL.id)],
    });
    expect(rows[0]?.quantity).toBe(8);
    expect(rows[0]?.lineTotalCents).toBe(8 * 250);
  });

  it("UNAVAILABLE and PENDING medicines get no suggestion", () => {
    const rows = build({
      prescriptions: [
        prescription([
          { name: "Ibuprofen", status: "UNAVAILABLE", prescribed: 10 },
          { name: "Cetirizine", status: "PENDING", prescribed: 10 },
        ]),
      ],
      priceList: [priceItem("i", "Ibuprofen", 1), priceItem("c", "Cetirizine", 1)],
    });
    expect(rows).toEqual([]);
  });

  it("a dispensed item with no dispensed quantity suggests nothing", () => {
    expect(build({ prescriptions: [prescription([{ name: "Zinc", status: "DISPENSED", dispensed: null }])] })).toEqual([]);
  });

  it("each test of a COMPLETED lab order is suggested once; a REQUESTED (not complete) order suggests nothing", () => {
    const rows = build({
      labOrders: [labOrder("COMPLETED", ["Full Blood Count", "Malaria RDT"]), labOrder("REQUESTED", ["Urinalysis"])],
    });
    expect(rows.map((r) => [r.kind, r.name, r.quantity])).toEqual([
      ["lab", "Full Blood Count", 1],
      ["lab", "Malaria RDT", 1],
    ]);
  });

  it("never suggests a consultation", () => {
    const rows = build({ priceList: [priceItem("cons", "Consultation", 300)], links: [link("consultation", "cons")] });
    expect(rows).toEqual([]);
  });

  it("two items with the same normalized name become one row with the quantities summed", () => {
    const rows = build({
      prescriptions: [
        prescription([{ name: "Paracetamol 500mg", status: "DISPENSED", dispensed: 10 }]),
        prescription([{ name: "  PARACETAMOL   500MG ", status: "PARTIALLY_DISPENSED", prescribed: 10, dispensed: 4 }]),
      ],
      priceList: [PARACETAMOL],
      links: [link("paracetamol 500mg", PARACETAMOL.id)],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Paracetamol 500mg", quantity: 14, state: "linked", lineTotalCents: 14 * 250 });
  });

  it("a medicine and a lab test with the same name stay separate rows", () => {
    const rows = build({
      prescriptions: [prescription([{ name: "Glucose", status: "DISPENSED", dispensed: 1 }])],
      labOrders: [labOrder("COMPLETED", ["Glucose"])],
    });
    expect(rows.map((r) => r.key)).toEqual(["medicine:glucose", "lab:glucose"]);
  });
});

describe("buildChargeSuggestions — matching to the price list", () => {
  const amoxDispensed = [prescription([{ name: "amoxicillin ", status: "DISPENSED", dispensed: 3 }])];

  it("linked: a saved link to an active item pre-fills the price", () => {
    const rows = build({ prescriptions: amoxDispensed, priceList: [AMOXICILLIN], links: [link("amoxicillin", AMOXICILLIN.id)] });
    expect(rows[0]).toMatchObject({ state: "linked", priceListItem: AMOXICILLIN, lineTotalCents: 3 * 1230 });
  });

  it("a link wins over a different same-name item", () => {
    const other = priceItem("p-amox-2", "Amoxicillin syrup", 99);
    const rows = build({ prescriptions: amoxDispensed, priceList: [AMOXICILLIN, other], links: [link("amoxicillin", other.id)] });
    expect(rows[0]).toMatchObject({ state: "linked", priceListItem: other });
  });

  it("confirm: no link, exactly one active item with the same normalized name", () => {
    const rows = build({ prescriptions: amoxDispensed, priceList: [AMOXICILLIN] });
    expect(rows[0]).toMatchObject({ state: "confirm", priceListItem: AMOXICILLIN, lineTotalCents: 3690 });
  });

  it("unmatched: no link and no same-name item — partial names never match", () => {
    const rows = build({ prescriptions: amoxDispensed, priceList: [priceItem("x", "Amoxicillin 250mg", 5), priceItem("y", "Amox", 5)] });
    expect(rows[0]).toMatchObject({ state: "unmatched", lineTotalCents: null });
    expect(rows[0]?.priceListItem).toBeUndefined();
  });

  it("unmatched: two active items share the normalized name, so neither is guessed", () => {
    const rows = build({
      prescriptions: amoxDispensed,
      priceList: [priceItem("a", "Amoxicillin", 5), priceItem("b", "AMOXICILLIN", 6)],
    });
    expect(rows[0]?.state).toBe("unmatched");
  });

  it("an inactive same-name item is not suggested", () => {
    const rows = build({ prescriptions: amoxDispensed, priceList: [priceItem("a", "Amoxicillin", 5, false)] });
    expect(rows[0]?.state).toBe("unmatched");
  });

  it("an inactive price-list item behind a saved link falls back to unmatched", () => {
    const inactive = priceItem("old", "Amoxicillin (old price)", 9, false);
    const rows = build({ prescriptions: amoxDispensed, priceList: [inactive], links: [link("amoxicillin", inactive.id)] });
    expect(rows[0]).toMatchObject({ state: "unmatched", lineTotalCents: null });
  });

  it("a link to an item missing from the price list is ignored", () => {
    const rows = build({ prescriptions: amoxDispensed, priceList: [], links: [link("amoxicillin", "gone")] });
    expect(rows[0]?.state).toBe("unmatched");
  });
});

describe("buildChargeSuggestions — already on the invoice", () => {
  const input = {
    labOrders: [labOrder("COMPLETED", ["Full Blood Count"])],
    priceList: [FBC],
    links: [link("full blood count", FBC.id)],
  };

  it("drops a suggestion whose description and unit price are already on the invoice", () => {
    expect(build({ ...input, invoiceItems: [{ description: "Full Blood Count", unitPrice: 450 }] })).toEqual([]);
    // Description compared normalized, price in cents.
    expect(build({ ...input, invoiceItems: [{ description: " full  blood count", unitPrice: 450.0 }] })).toEqual([]);
  });

  it("keeps it when the same description was charged at a different price", () => {
    expect(build({ ...input, invoiceItems: [{ description: "Full Blood Count", unitPrice: 400 }] })).toHaveLength(1);
  });

  it("drops a confirm row already on the invoice too", () => {
    const rows = build({ ...input, links: [], invoiceItems: [{ description: "Full Blood Count", unitPrice: 450 }] });
    expect(rows).toEqual([]);
  });
});

describe("adding", () => {
  it("a suggestion becomes the price-list item's name and unit price at the suggested quantity", () => {
    const [row] = build({
      prescriptions: [prescription([{ name: "Paracetamol 500mg", status: "PARTIALLY_DISPENSED", prescribed: 20, dispensed: 8 }])],
      priceList: [PARACETAMOL],
      links: [link("paracetamol 500mg", PARACETAMOL.id)],
    });
    expect(suggestionToInvoiceItem(row!)).toEqual({ description: "Paracetamol 500mg", quantity: 8, unitPrice: 2.5 });
  });

  it("an unmatched row has nothing to add", () => {
    const [row] = build({ prescriptions: [prescription([{ name: "Zinc", status: "DISPENSED", dispensed: 2 }])] });
    expect(suggestionToInvoiceItem(row!)).toBeNull();
  });

  it("Add all takes only linked rows — never confirm or unmatched", () => {
    const rows = build({
      prescriptions: [
        prescription([
          { name: "Paracetamol 500mg", status: "DISPENSED", dispensed: 10 },
          { name: "Amoxicillin", status: "DISPENSED", dispensed: 21 },
          { name: "Zinc", status: "DISPENSED", dispensed: 2 },
        ]),
      ],
      priceList: [PARACETAMOL, AMOXICILLIN],
      links: [link("paracetamol 500mg", PARACETAMOL.id)],
    });
    expect(rows.map((r) => r.state)).toEqual(["linked", "confirm", "unmatched"]);
    expect(addAllItems(rows)).toEqual([{ description: "Paracetamol 500mg", quantity: 10, unitPrice: 2.5 }]);
  });
});
