// Core shared types for PatternForge.

export type Pt = { x: number; y: number };

/** A node (vertex) of the planar subdivision — a junction where 3+ regions
 * meet, a point on the panel border, or an anchor of a closed-loop arc. */
export interface GNode {
  id: number;
  p: Pt;
}

/** An arc is a polyline edge of the planar subdivision, shared by EXACTLY two
 * faces: `left` and `right` (region ids; -1 = outside the panel).
 * pts includes both endpoints. For a closed loop, first === last point and
 * a === b (same node). */
export interface Arc {
  id: number;
  a: number; // node id at pts[0]
  b: number; // node id at pts[last]
  pts: Pt[];
  left: number; // region id on the left when walking a -> b
  right: number; // region id on the right
}

/** A glass piece (face of the subdivision). Geometry is derived from arcs. */
export interface Region {
  id: number;
  colorIdx: number; // index into palette
}

export interface PaletteColor {
  hex: string;
  rgb: [number, number, number];
  /** user flag: textured / streaky / directional glass (adds 15% waste) */
  directional: boolean;
  /** optional per-color price per purchase unit */
  pricePerUnit?: number;
  name?: string;
}

/** The whole editable pattern: a shared-edge planar subdivision. */
export interface PatternGraph {
  nodes: Map<number, GNode>;
  arcs: Map<number, Arc>;
  regions: Map<number, Region>;
  palette: PaletteColor[];
  /** panel size in source (pixel) coordinates; scaled to real units on output */
  width: number;
  height: number;
  nextId: number;
}

/** One boundary loop of a face, assembled from arcs. */
export interface FaceLoop {
  /** arc ids with direction: positive = forward (a->b), negative = reversed */
  arcRefs: number[];
  pts: Pt[]; // closed polygon (first point NOT repeated at end)
  area: number; // signed; CCW positive in y-down coords means... we store abs
}

/** Derived per-region geometry, rebuilt after every topology change. */
export interface Face {
  regionId: number;
  outer: FaceLoop;
  holes: FaceLoop[]; // non-empty => NOT simply connected => un-cuttable
  area: number; // outer minus holes, px^2
  labelPos: Pt; // pole of inaccessibility (approx)
}

export type WarningKind = "hole" | "sliver" | "concave";

export interface PieceWarning {
  regionId: number;
  kind: WarningKind;
  message: string;
}

export type Units = "mm" | "cm" | "in";
/** How aggressively lines are simplified/smoothed. "detailed" follows the
 * image closely; "flowing" gives long easy curves; "straight" reduces lines
 * to straight segments — impression of the image, much easier to cut. */
export type Smoothness = "detailed" | "smooth" | "flowing" | "straight";
export type Assembly = "lead" | "foil";
export type Skill = "beginner" | "intermediate" | "advanced";
export type PageSize = "letter" | "a4";

export interface Settings {
  widthValue: number;
  heightValue: number;
  units: Units;
  colorBucket: "lt5" | "5to10" | "10to20";
  colorCount: number; // fine slider within bucket range
  density: "low" | "medium" | "high";
  smoothness: Smoothness;
  assembly: Assembly;
  cameWidthIn: number; // came width in inches (e.g. 3/16)
  skill: Skill;
  purchaseUnit: "sqft" | "sqm";
  minPurchase: number; // in purchase units
  sheetW?: number; // optional sheet size, in purchase-unit linear dims (in/cm)
  sheetH?: number;
  globalPricePerUnit?: number;
  pageSize: PageSize;
}

export const BUCKET_RANGES: Record<Settings["colorBucket"], [number, number]> = {
  lt5: [2, 4],
  "5to10": [5, 10],
  "10to20": [10, 20],
};

export const DEFAULT_SETTINGS: Settings = {
  widthValue: 300,
  heightValue: 400,
  units: "mm",
  colorBucket: "5to10",
  colorCount: 7,
  density: "medium",
  smoothness: "smooth",
  assembly: "lead",
  cameWidthIn: 3 / 16,
  skill: "intermediate",
  purchaseUnit: "sqft",
  minPurchase: 1,
  pageSize: "letter",
};

export function unitToMm(u: Units): number {
  return u === "mm" ? 1 : u === "cm" ? 10 : 25.4;
}
