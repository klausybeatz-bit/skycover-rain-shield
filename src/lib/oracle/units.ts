/**
 * Unit normalisation for the live-data layer.
 *
 * Sources disagree about units far more often than they disagree about values,
 * so every number is converted to the app's canonical unit *before* it is
 * validated or stored:
 *   - rainfall -> millimetres
 *   - mandi price -> INR per quintal (100 kg)
 *
 * A conversion that cannot be performed confidently returns null. Null means
 * "we do not know", which callers must surface as "Data unavailable" rather
 * than coercing to zero.
 */

/** Multipliers that convert a rainfall unit into millimetres. */
const RAINFALL_FACTORS: Record<string, number> = {
  mm: 1,
  mms: 1,
  millimeter: 1,
  millimeters: 1,
  millimetre: 1,
  millimetres: 1,
  cm: 10,
  centimeter: 10,
  centimeters: 10,
  centimetre: 10,
  centimetres: 10,
  m: 1000,
  meter: 1000,
  meters: 1000,
  metre: 1000,
  metres: 1000,
  in: 25.4,
  inch: 25.4,
  inches: 25.4,
  inche: 25.4,
};

export function toMillimetres(value: number, unit: string): number | null {
  if (!Number.isFinite(value)) return null;
  const key = unit.trim().toLowerCase().replace(/[.\s"]/g, "");
  const factor = RAINFALL_FACTORS[key];
  if (factor === undefined) return null;
  return roundTo(value * factor, 2);
}

/** Round to a fixed number of decimals without float drift in the string form. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** One decimal is the precision rainfall is reported and reported-on at. */
export function roundMm(value: number): number {
  return roundTo(value, 1);
}

/**
 * Pull the first numeric token out of a scraped cell.
 * Handles "1,234.5", "₹2,150/-", "2150 Rs/Quintal", "—".
 */
export function parseNumericCell(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value : null;
}

/** Multipliers that convert a price unit into INR per quintal. */
const PRICE_FACTORS: Record<string, number> = {
  quintal: 1,
  quintals: 1,
  qtl: 1,
  qt: 1,
  "100kg": 1,
  "100kgs": 1,
  tonne: 0.1,
  tonnes: 0.1,
  ton: 0.1,
  tons: 0.1,
  mt: 0.1,
  kg: 100,
  kilogram: 100,
  kilograms: 100,
};

export type PriceUnit = "quintal" | "tonne" | "kg";

/**
 * Read a price unit out of free text such as "Rs/Quintal", "₹/MT" or "per kg".
 * Returns null when the unit cannot be determined — an unlabelled price cannot
 * be normalised, and silently assuming quintal would 10x or 100x a figure.
 */
export function parsePriceUnit(raw: string): PriceUnit | null {
  const text = raw.toLowerCase();
  // "100 kg" is a quintal, so the hundredweight spellings must be tested before
  // the bare kg case, which would otherwise match it and divide the price by 100.
  if (/quintal|\bqtl\b|\bqt\b|100\s*kg/.test(text)) return "quintal";
  if (/tonne|ton\b|\bmt\b|metric\s*ton/.test(text)) return "tonne";
  if (/\bkg\b|kilogram|per\s*kg/.test(text)) return "kg";
  return null;
}

export function toInrPerQuintal(value: number, unit: PriceUnit): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const factor = PRICE_FACTORS[unit];
  if (factor === undefined) return null;
  return roundTo(value * factor, 2);
}

/**
 * Minimum rainfall that can be reported on-chain. The contract takes whole
 * millimetres, so a sub-millimetre reading must be rounded the same way in
 * both directions of the pipeline or the quote and the report disagree.
 */
export function toContractMm(totalMm: number): number {
  return Math.max(0, Math.round(totalMm));
}
