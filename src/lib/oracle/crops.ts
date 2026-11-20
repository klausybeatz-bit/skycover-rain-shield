/**
 * The crop catalogue.
 *
 * Kept separate from ./market.ts so the browser can render the crop selector
 * without pulling in the TinyFish client (and its server-only configuration).
 * Nothing here is secret.
 */

import type { CropOption } from "./types";

/**
 * Crops SkyCover can ask about. `aliases` exist because sources spell the same
 * commodity differently (Paddy vs Rice, Bengal Gram vs Chana).
 */
export const CROP_OPTIONS: ReadonlyArray<CropOption> = [
  { name: "Paddy", aliases: ["Paddy", "Rice", "Dhan"] },
  { name: "Wheat", aliases: ["Wheat", "Gehun"] },
  { name: "Maize", aliases: ["Maize", "Makka", "Corn"] },
  { name: "Cotton", aliases: ["Cotton", "Kapas"] },
  { name: "Soyabean", aliases: ["Soyabean", "Soybean", "Soya"] },
  { name: "Groundnut", aliases: ["Groundnut", "Moongphali"] },
  { name: "Onion", aliases: ["Onion", "Pyaz"] },
  { name: "Potato", aliases: ["Potato", "Aloo"] },
  { name: "Tomato", aliases: ["Tomato"] },
  { name: "Bengal Gram", aliases: ["Bengal Gram", "Chana", "Gram"] },
  { name: "Tur", aliases: ["Tur", "Arhar", "Pigeon Pea"] },
  { name: "Mustard", aliases: ["Mustard", "Rapeseed", "Sarson"] },
];

export function listCrops(): string[] {
  return CROP_OPTIONS.map((crop) => crop.name);
}

/** Every spelling a source might use for this crop. */
export function aliasesFor(crop: string): string[] {
  const match = CROP_OPTIONS.find((option) => option.name.toLowerCase() === crop.trim().toLowerCase());
  return match ? [...match.aliases] : [crop.trim()];
}
