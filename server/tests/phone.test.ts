import { describe, it, expect } from "vitest";
import { MIN_PHONE_DIGITS, normalizePhone } from "../src/utils/phone";

describe("normalizePhone", () => {
  it("treats the local 0-prefixed form and the +251 form as the same number", () => {
    expect(normalizePhone("0935259622")).toBe("935259622");
    expect(normalizePhone("+251935259622")).toBe("935259622");
    expect(normalizePhone("251935259622")).toBe("935259622");
    expect(normalizePhone("935259622")).toBe("935259622");
  });

  it("ignores spaces", () => {
    expect(normalizePhone("0935 259 622")).toBe("935259622");
    expect(normalizePhone("+251 935 259 622")).toBe("935259622");
    expect(normalizePhone("  0935259622  ")).toBe("935259622");
  });

  it("ignores hyphens, dots and parentheses", () => {
    expect(normalizePhone("0935-259-622")).toBe("935259622");
    expect(normalizePhone("(0935) 259.622")).toBe("935259622");
    expect(normalizePhone("+251 (0) 935-259-622")).toBe("935259622");
  });

  it("ignores unicode spaces", () => {
    // no-break space, em space, ideographic space, narrow no-break space
    expect(normalizePhone("0935 259 622")).toBe("935259622");
    expect(normalizePhone("+251　935 259622")).toBe("935259622");
  });

  it("returns null for blank or missing input — which never conflicts", () => {
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
    expect(normalizePhone(" - ( ) ")).toBeNull();
  });

  it(`returns null for too-short input (fewer than ${MIN_PHONE_DIGITS} digits after normalizing)`, () => {
    expect(normalizePhone("+")).toBeNull();
    expect(normalizePhone("0")).toBeNull();
    expect(normalizePhone("251")).toBeNull();
    expect(normalizePhone("+251 0")).toBeNull();
    expect(normalizePhone("0911")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("123456")).toBe("123456");
  });

  it("strips only one country prefix and one trunk 0, and only at the start", () => {
    expect(normalizePhone("0251935259622")).toBe("251935259622");
    expect(normalizePhone("00935259622")).toBe("0935259622");
    expect(normalizePhone("0935250251")).toBe("935250251");
  });

  it("keeps different numbers different", () => {
    expect(normalizePhone("0935259622")).not.toBe(normalizePhone("0935259623"));
    expect(normalizePhone("0935259622")).not.toBe(normalizePhone("09352596220"));
  });

  it("is idempotent for normal numbers", () => {
    const once = normalizePhone("+251 935 259 622")!;
    expect(normalizePhone(once)).toBe(once);
  });
});
