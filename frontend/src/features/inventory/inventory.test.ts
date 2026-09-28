import { describe, expect, it } from "vitest";
import { ApiError } from "../../api";
import { inventoryErrorMessage, validateInventoryForm } from "./inventoryForm";

describe("validateInventoryForm (name 1–255, unit 1–50, quantity 0–10,000,000)", () => {
  it("trims and builds the body", () => {
    expect(validateInventoryForm({ name: " Amoxicillin 500mg ", unit: " capsule ", quantityOnHand: " 120 " })).toEqual({
      ok: true,
      body: { name: "Amoxicillin 500mg", unit: "capsule", quantityOnHand: 120 },
    });
  });

  it("allows zero stock", () => {
    expect(validateInventoryForm({ name: "ORS", unit: "sachet", quantityOnHand: "0" }).ok).toBe(true);
  });

  it("requires name, unit and quantity", () => {
    const result = validateInventoryForm({ name: " ", unit: "", quantityOnHand: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["name", "quantityOnHand", "unit"]);
  });

  it("enforces the length and quantity limits", () => {
    expect(validateInventoryForm({ name: "n".repeat(255), unit: "u".repeat(50), quantityOnHand: "10000000" }).ok).toBe(true);
    const result = validateInventoryForm({ name: "n".repeat(256), unit: "u".repeat(51), quantityOnHand: "10000001" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["name", "quantityOnHand", "unit"]);
  });

  it("refuses negative, decimal and text quantities", () => {
    for (const bad of ["-1", "1.5", "ten"]) {
      expect(validateInventoryForm({ name: "A", unit: "tab", quantityOnHand: bad }).ok, bad).toBe(false);
    }
  });
});

describe("inventoryErrorMessage", () => {
  it("explains INVENTORY_ITEM_ALREADY_EXISTS", () => {
    expect(
      inventoryErrorMessage(new ApiError(409, "INVENTORY_ITEM_ALREADY_EXISTS", 'An inventory item named "ORS" already exists'))
    ).toMatch(/already exists/);
  });
});
