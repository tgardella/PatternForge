import type { Pt } from "./types";

/** Signed area of a closed polygon (first point not repeated).
 * Positive = counter-clockwise in a y-UP frame; our canvas is y-down, so
 * positive here means clockwise on screen. We mostly use |area|. */
export function signedArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

export function polygonPerimeter(pts: Pt[]): number {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    s += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return s;
}

export function centroid(pts: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const cr = p.x * q.y - q.x * p.y;
    a += cr;
    cx += (p.x + q.x) * cr;
    cy += (p.y + q.y) * cr;
  }
  if (Math.abs(a) < 1e-9) {
    // degenerate: average
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p.x; sy += p.y; }
    return { x: sx / pts.length, y: sy / pts.length };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function pointInPolygon(p: Pt, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const pi = pts[i], pj = pts[j];
    if (
      pi.y > p.y !== pj.y > p.y &&
      p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x
    )
      inside = !inside;
  }
  return inside;
}

export function distPointToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToPolygonBoundary(p: Pt, pts: Pt[]): number {
  let d = Infinity;
  for (let i = 0, n = pts.length; i < n; i++) {
    d = Math.min(d, distPointToSegment(p, pts[i], pts[(i + 1) % n]));
  }
  return d;
}

/** Approximate pole of inaccessibility: best label position inside polygon
 * (with holes). Grid + refine; good enough for piece numbering. */
export function poleOfInaccessibility(outer: Pt[], holes: Pt[][] = []): Pt {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of outer) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const inside = (p: Pt) =>
    pointInPolygon(p, outer) && !holes.some((h) => pointInPolygon(p, h));
  const clearance = (p: Pt) => {
    let d = distToPolygonBoundary(p, outer);
    for (const h of holes) d = Math.min(d, distToPolygonBoundary(p, h));
    return d;
  };
  let best: Pt = centroid(outer);
  let bestD = inside(best) ? clearance(best) : -1;
  const N = 12;
  // Sample strictly inside cells at an irrational-ish offset: simplified /
  // smoothed polygons have many vertices on exact .0 / .5 coordinates, and a
  // ray cast through a row of collinear vertices is numerically degenerate
  // (can report far-outside points as "inside" with huge clearance).
  const OFF = 0.381966;
  for (let pass = 0; pass < 3; pass++) {
    let px = best.x, py = best.y;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const p = {
          x: minX + ((i + OFF) / (N + 1)) * (maxX - minX),
          y: minY + ((j + OFF) / (N + 1)) * (maxY - minY),
        };
        if (!inside(p)) continue;
        const d = clearance(p);
        if (d > bestD) { bestD = d; best = p; px = p.x; py = p.y; }
      }
    }
    // shrink search window around best
    const sw = (maxX - minX) / N, sh = (maxY - minY) / N;
    minX = px - sw; maxX = px + sw; minY = py - sh; maxY = py + sh;
  }
  // final sanity: never return a point whose clearance is ~zero if the
  // centroid is a valid interior fallback
  if (bestD <= 0) {
    const c = centroid(outer);
    if (inside(c)) return c;
  }
  return best;
}

export function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/** Minimum-area bounding rectangle via rotating calipers. Returns area. */
export function minAreaRect(points: Pt[]): { area: number; w: number; h: number } {
  const hull = convexHull(points);
  if (hull.length < 3) {
    // degenerate: line or point
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    return { area: 0, w: maxX - minX, h: maxY - minY };
  }
  let best = { area: Infinity, w: 0, h: 0 };
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-12) continue;
    const ux = ex / len, uy = ey / len; // edge direction
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const u = (p.x - a.x) * ux + (p.y - a.y) * uy;
      const v = -(p.x - a.x) * uy + (p.y - a.y) * ux;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const w = maxU - minU, h = maxV - minV;
    if (w * h < best.area) best = { area: w * h, w, h };
  }
  return best;
}

/** Douglas–Peucker simplification. Keeps first & last points. */
export function douglasPeucker(pts: Pt[], epsilon: number): Pt[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1, maxI = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distPointToSegment(pts[i], pts[s], pts[e]);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > epsilon) {
      keep[maxI] = 1;
      stack.push([s, maxI], [maxI, e]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/** One round of Chaikin corner-cutting, endpoints fixed (open polyline). */
export function chaikinOpen(pts: Pt[], iterations = 1): Pt[] {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    if (cur.length < 3) return cur;
    const out: Pt[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const p = cur[i], q = cur[i + 1];
      const a = { x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 };
      const b = { x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 };
      if (i === 0) out.push(b);
      else if (i === cur.length - 2) out.push(a);
      else out.push(a, b);
    }
    out.push(cur[cur.length - 1]);
    cur = out;
  }
  return cur;
}

/** Interior angles: flag sharp reflex (deep notch) vertices.
 * Returns worst interior angle in degrees (0..360) that is reflex, or null. */
export function worstReflexAngle(pts: Pt[]): number | null {
  // Ensure consistent orientation: compute signed area; interior is on one side
  const n = pts.length;
  if (n < 4) return null;
  const ccw = signedArea(pts) > 0; // in y-down screen coords this is CW visually
  let worst: number | null = null;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const a1 = Math.atan2(p0.y - p1.y, p0.x - p1.x);
    const a2 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    // interior angle measured on the polygon's interior side
    let ang = ccw ? a1 - a2 : a2 - a1;
    while (ang < 0) ang += Math.PI * 2;
    while (ang >= Math.PI * 2) ang -= Math.PI * 2;
    const deg = (ang * 180) / Math.PI;
    if (deg > 180) {
      if (worst === null || deg > worst) worst = deg;
    }
  }
  return worst;
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
