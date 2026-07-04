// Glass-per-color material estimate (shown on the plan page).
// All areas are computed in FINISHED real-world units via the mm scale.

import type { Face, PatternGraph, Settings, Skill } from "./types";
import { minAreaRect } from "./geometry";

export const BREAKAGE: Record<Skill, number> = {
  beginner: 0.25,
  intermediate: 0.15,
  advanced: 0.1,
};

export const SQFT_MM2 = 92903.04; // (304.8 mm)^2
export const SQM_MM2 = 1_000_000;

export interface ColorEstimate {
  colorIdx: number;
  hex: string;
  directional: boolean;
  pieceCount: number;
  netAreaMm2: number;
  packEff: number; // net / sum of min-area bounding boxes
  breakage: number;
  nesting: number;
  directionalWaste: number;
  waste: number; // total fraction
  buyUnits: number; // in purchase units, rounded up, >= minPurchase
  sheets?: number;
  price?: number;
}

export interface EstimateResult {
  colors: ColorEstimate[];
  totalNetMm2: number;
  totalBuyUnits: number;
  totalPrice?: number;
  unitLabel: string;
  unitAreaMm2: number;
}

export function estimateGlass(
  graph: PatternGraph,
  faces: Face[],
  settings: Settings,
  pxToMm: number
): EstimateResult {
  const unitAreaMm2 = settings.purchaseUnit === "sqft" ? SQFT_MM2 : SQM_MM2;
  const unitLabel = settings.purchaseUnit === "sqft" ? "sq ft" : "m²";
  const mm2PerPx2 = pxToMm * pxToMm;

  const byColor = new Map<number, Face[]>();
  for (const f of faces) {
    const region = graph.regions.get(f.regionId);
    if (!region) continue;
    let list = byColor.get(region.colorIdx);
    if (!list) byColor.set(region.colorIdx, (list = []));
    list.push(f);
  }

  const colors: ColorEstimate[] = [];
  let totalNetMm2 = 0;
  let totalBuyUnits = 0;
  let totalPrice: number | undefined;

  // optional sheet area, entered in inches (sqft) or cm (sqm)
  let sheetAreaUnits: number | undefined;
  if (settings.sheetW && settings.sheetH) {
    const linMm = settings.purchaseUnit === "sqft" ? 25.4 : 10;
    sheetAreaUnits =
      (settings.sheetW * linMm * settings.sheetH * linMm) / unitAreaMm2;
  }

  for (const [colorIdx, list] of [...byColor.entries()].sort((a, b) => a[0] - b[0])) {
    const pal = graph.palette[colorIdx];
    const netAreaMm2 = list.reduce((s, f) => s + f.area * mm2PerPx2, 0);
    const bboxSumMm2 = list.reduce(
      (s, f) => s + minAreaRect(f.outer.pts).area * mm2PerPx2,
      0
    );
    const packEff = bboxSumMm2 > 0 ? netAreaMm2 / bboxSumMm2 : 1;
    const breakage = BREAKAGE[settings.skill];
    const nesting = Math.min(0.35, Math.max(0, 0.6 * (1 - packEff)));
    const directionalWaste = pal?.directional ? 0.15 : 0;
    const waste = breakage + nesting + directionalWaste;
    const rawUnits = (netAreaMm2 * (1 + waste)) / unitAreaMm2;
    const buyUnits = Math.max(settings.minPurchase, Math.ceil(rawUnits));

    const pricePer = pal?.pricePerUnit ?? settings.globalPricePerUnit;
    const price = pricePer != null ? buyUnits * pricePer : undefined;
    const sheets = sheetAreaUnits ? Math.ceil(buyUnits / sheetAreaUnits) : undefined;

    totalNetMm2 += netAreaMm2;
    totalBuyUnits += buyUnits;
    if (price != null) totalPrice = (totalPrice ?? 0) + price;

    colors.push({
      colorIdx,
      hex: pal?.hex ?? "#888888",
      directional: pal?.directional ?? false,
      pieceCount: list.length,
      netAreaMm2,
      packEff,
      breakage,
      nesting,
      directionalWaste,
      waste,
      buyUnits,
      sheets,
      price,
    });
  }

  return { colors, totalNetMm2, totalBuyUnits, totalPrice, unitLabel, unitAreaMm2 };
}

export function fmtArea(mm2: number, unit: "sqft" | "sqm"): string {
  const v = mm2 / (unit === "sqft" ? SQFT_MM2 : SQM_MM2);
  return `${v.toFixed(2)} ${unit === "sqft" ? "sq ft" : "m²"}`;
}
