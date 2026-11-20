import { describe, expect, it } from "vitest";

import {
  parseNumericCell,
  parsePriceUnit,
  roundMm,
  roundTo,
  toContractMm,
  toInrPerQuintal,
  toMillimetres,
} from "./units";

describe("rainfall unit conversion", () => {
  it("converts every supported unit into millimetres", () => {
    expect(toMillimetres(1, "mm")).toBe(1);
    expect(toMillimetres(1, "MM")).toBe(1);
    expect(toMillimetres(1, "cm")).toBe(10);
    expect(toMillimetres(2.5, "cm")).toBe(25);
    expect(toMillimetres(1, "in")).toBe(25.4);
    expect(toMillimetres(2, "inches")).toBe(50.8);
    expect(toMillimetres(1, "m")).toBe(1000);
  });

  it("returns null for a unit it does not recognise rather than guessing", () => {
    expect(toMillimetres(5, "furlongs")).toBeNull();
    expect(toMillimetres(5, "")).toBeNull();
  });

  it("returns null for a non-finite value", () => {
    expect(toMillimetres(Number.NaN, "mm")).toBeNull();
    expect(toMillimetres(Number.POSITIVE_INFINITY, "mm")).toBeNull();
  });

  it("rounds to the precision rainfall is reported at", () => {
    expect(roundMm(1.44)).toBe(1.4);
    expect(roundMm(1.45)).toBe(1.5);
    expect(roundTo(1.005, 2)).toBe(1.01);
  });
});

describe("price cell parsing", () => {
  it("reads a number out of the shapes mandi pages use", () => {
    expect(parseNumericCell("₹2,150/-")).toBe(2150);
    expect(parseNumericCell("2150 Rs/Quintal")).toBe(2150);
    expect(parseNumericCell("1,234.5")).toBe(1234.5);
  });

  it("returns null when a cell holds no number", () => {
    expect(parseNumericCell("—")).toBeNull();
    expect(parseNumericCell("-")).toBeNull();
    expect(parseNumericCell("N/A")).toBeNull();
  });
});

describe("price unit parsing", () => {
  it("recognises the published mandi units", () => {
    expect(parsePriceUnit("Rs/Quintal")).toBe("quintal");
    expect(parsePriceUnit("₹/MT")).toBe("tonne");
    expect(parsePriceUnit("per kg")).toBe("kg");
  });

  it("treats 100 kg as a quintal, not as kg", () => {
    // Getting this backwards would divide every price by 100.
    expect(parsePriceUnit("100 kg")).toBe("quintal");
    expect(parsePriceUnit("Rs per 100 kg")).toBe("quintal");
  });

  it("returns null for an unlabelled unit so no factor is assumed", () => {
    expect(parsePriceUnit("Rs")).toBeNull();
    expect(parsePriceUnit("")).toBeNull();
  });
});

describe("price normalisation to INR per quintal", () => {
  it("leaves quintal prices untouched", () => {
    expect(toInrPerQuintal(2150, "quintal")).toBe(2150);
  });

  it("converts kg and tonne prices into quintals", () => {
    expect(toInrPerQuintal(21.5, "kg")).toBe(2150);
    expect(toInrPerQuintal(21500, "tonne")).toBe(2150);
  });

  it("rejects zero and negative prices", () => {
    expect(toInrPerQuintal(0, "quintal")).toBeNull();
    expect(toInrPerQuintal(-5, "quintal")).toBeNull();
  });
});

describe("contract reporting", () => {
  it("rounds to whole millimetres and never goes negative", () => {
    expect(toContractMm(12.4)).toBe(12);
    expect(toContractMm(12.5)).toBe(13);
    expect(toContractMm(-3)).toBe(0);
  });
});
