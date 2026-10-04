import { describe, it, expect } from "vitest";
import { normalizeChargeName } from "../src/utils/chargeName";

describe("normalizeChargeName", () => {
  it("lowercases", () => {
    expect(normalizeChargeName("Paracetamol 500MG")).toBe("paracetamol 500mg");
  });

  it("trims and collapses runs of spaces, tabs and newlines to one space", () => {
    expect(normalizeChargeName("  Full   Blood\tCount \n")).toBe("full blood count");
  });

  it("treats unicode spaces like ordinary spaces", () => {
    // no-break space, em space, ideographic space, narrow no-break space
    expect(normalizeChargeName(" Malaria RDT　test ")).toBe("malaria rdt test");
    expect(normalizeChargeName("Malaria  RDT")).toBe(normalizeChargeName("malaria rdt"));
  });

  it("is idempotent", () => {
    const once = normalizeChargeName("  Amoxicillin   250 mg ");
    expect(normalizeChargeName(once)).toBe(once);
  });

  it("does nothing fuzzy: punctuation, hyphens and inner letters still differ", () => {
    expect(normalizeChargeName("X-ray")).not.toBe(normalizeChargeName("X ray"));
    expect(normalizeChargeName("Paracetamol")).not.toBe(normalizeChargeName("Paracetamol 500mg"));
  });
});
