// Arc simplification: Douglas–Peucker + light Chaikin smoothing so lead
// lines flow. Because each arc is SHARED by its two pieces, simplifying the
// arc keeps both sides perfectly coincident — no gaps, ever.

import { chaikinOpen, douglasPeucker } from "../geometry";
import type { TracedArc } from "./trace";

export function simplifyArcs(
  arcs: TracedArc[],
  epsilon = 1.6,
  smoothIterations = 2
): TracedArc[] {
  return arcs.map((arc) => {
    const isBorder = arc.left === -1 || arc.right === -1;
    if (isBorder) {
      // panel outline stays crisp and straight
      return { ...arc, pts: douglasPeucker(arc.pts, 0.01) };
    }
    let pts = douglasPeucker(arc.pts, epsilon);
    pts = chaikinOpen(pts, smoothIterations);
    // re-thin after smoothing (Chaikin doubles point count)
    pts = douglasPeucker(pts, 0.35);
    return { ...arc, pts };
  });
}
