// Arc simplification: Douglas–Peucker + Chaikin smoothing so lead lines flow.
// Because each arc is SHARED by its two pieces, simplifying the arc keeps
// both sides perfectly coincident — no gaps, ever.
//
// The smoothness knob trades fidelity for cuttability: heavier simplification
// gives long, easy curves (or plain straight segments) that keep the
// impression of the image without replicating every wiggle.

import { chaikinOpen, douglasPeucker } from "../geometry";
import type { Smoothness } from "../types";
import type { TracedArc } from "./trace";

/** epsilon in px (≤1000 px canvas), Chaikin iterations */
const PARAMS: Record<Smoothness, { epsilon: number; iterations: number }> = {
  detailed: { epsilon: 1.6, iterations: 2 },
  smooth: { epsilon: 4.5, iterations: 3 },
  flowing: { epsilon: 10, iterations: 3 },
  straight: { epsilon: 8, iterations: 0 },
};

export function simplifyArcs(
  arcs: TracedArc[],
  smoothness: Smoothness = "smooth"
): TracedArc[] {
  const { epsilon, iterations } = PARAMS[smoothness];
  return arcs.map((arc) => {
    const isBorder = arc.left === -1 || arc.right === -1;
    if (isBorder) {
      // panel outline stays crisp and straight
      return { ...arc, pts: douglasPeucker(arc.pts, 0.01) };
    }
    let pts = douglasPeucker(arc.pts, epsilon);
    if (iterations > 0) {
      pts = chaikinOpen(pts, iterations);
      // re-thin after smoothing (Chaikin doubles point count)
      pts = douglasPeucker(pts, 0.35);
    }
    return { ...arc, pts };
  });
}
