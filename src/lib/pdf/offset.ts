// Polygon offsetting (came allowance) via ClipperJS.
// Negative delta = inset (trim each edge by half the came width).

import ClipperLib from "clipper-lib";
import type { Pt } from "../types";

const SCALE = 1000; // clipper works on integers; 1 unit = 0.001 mm

export function offsetPolygonMm(pts: Pt[], deltaMm: number): Pt[][] {
  if (Math.abs(deltaMm) < 1e-6) return [pts];
  const path = pts.map((p) => ({
    X: Math.round(p.x * SCALE),
    Y: Math.round(p.y * SCALE),
  }));
  const co = new ClipperLib.ClipperOffset(2, 0.1 * SCALE);
  co.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const solution: { X: number; Y: number }[][] = [];
  co.Execute(solution, deltaMm * SCALE);
  return solution.map((sol) => sol.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })));
}
