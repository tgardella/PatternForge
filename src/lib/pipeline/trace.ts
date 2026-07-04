// Boundary extraction as a planar subdivision ("crack" tracing).
// Every boundary between two regions becomes ONE arc shared by exactly two
// faces — never two independent polygons. Vertices (nodes) sit at junctions
// where 3+ regions meet, at panel corners, and anchor any closed loops.

import type { Pt } from "../types";
import type { RegionMap } from "./regions";

export interface TracedArc {
  a: number; // node point id (lattice)
  b: number;
  pts: Pt[];
  left: number; // region id on left when walking a->b (-1 = outside panel)
  right: number;
}

export interface TraceResult {
  arcs: TracedArc[];
  /** lattice point id -> Pt for every node */
  nodes: Map<number, Pt>;
  width: number; // in lattice units == pixel width
  height: number;
}

interface Crack {
  pA: number; // lattice point id (vertical: upper end; horizontal: west end)
  pB: number;
  la: number; // vertical: west pixel label; horizontal: north pixel label
  lb: number; // vertical: east pixel label; horizontal: south pixel label
  vertical: boolean;
}

export function traceBoundaries(rm: RegionMap): TraceResult {
  const { width: w, height: h, regions } = rm;
  const P = (x: number, y: number) => y * (w + 1) + x;
  const label = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h ? -1 : regions[y * w + x];

  const cracks: Crack[] = [];
  // vertical cracks at lattice x, spanning (x,y)-(x,y+1)
  for (let x = 0; x <= w; x++) {
    for (let y = 0; y < h; y++) {
      const west = label(x - 1, y), east = label(x, y);
      if (west !== east)
        cracks.push({ pA: P(x, y), pB: P(x, y + 1), la: west, lb: east, vertical: true });
    }
  }
  // horizontal cracks at lattice y, spanning (x,y)-(x+1,y)
  for (let y = 0; y <= h; y++) {
    for (let x = 0; x < w; x++) {
      const north = label(x, y - 1), south = label(x, y);
      if (north !== south)
        cracks.push({ pA: P(x, y), pB: P(x + 1, y), la: north, lb: south, vertical: false });
    }
  }

  // incidence: point -> crack ids
  const incident = new Map<number, number[]>();
  for (let c = 0; c < cracks.length; c++) {
    const { pA, pB } = cracks[c];
    let l = incident.get(pA);
    if (!l) incident.set(pA, (l = []));
    l.push(c);
    l = incident.get(pB);
    if (!l) incident.set(pB, (l = []));
    l.push(c);
  }

  const pairKey = (c: Crack) => {
    const lo = Math.min(c.la, c.lb), hi = Math.max(c.la, c.lb);
    return lo * 2097152 + hi;
  };

  // nodes: degree != 2, degree 2 with different region pairs, or panel corners
  const isNode = new Set<number>();
  for (const [pt, list] of incident) {
    if (list.length !== 2) isNode.add(pt);
    else if (pairKey(cracks[list[0]]) !== pairKey(cracks[list[1]])) isNode.add(pt);
  }
  for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]]) {
    if (incident.has(P(cx, cy))) isNode.add(P(cx, cy));
  }

  const toPt = (id: number): Pt => ({ x: id % (w + 1), y: Math.floor(id / (w + 1)) });

  const visited = new Uint8Array(cracks.length);
  const arcs: TracedArc[] = [];
  const nodes = new Map<number, Pt>();

  /** Walk a chain starting at node `start` through crack `c0`. */
  const walk = (start: number, c0: number) => {
    const ptIds: number[] = [start];
    let prev = start;
    let c = c0;
    for (;;) {
      visited[c] = 1;
      const cr = cracks[c];
      const nextPt = cr.pA === prev ? cr.pB : cr.pA;
      ptIds.push(nextPt);
      if (isNode.has(nextPt)) break;
      const list = incident.get(nextPt)!;
      const nc = list[0] === c ? list[1] : list[0];
      prev = nextPt;
      c = nc;
    }
    // orientation: derive left/right from the first crack traversed
    const first = cracks[c0];
    const p0 = toPt(ptIds[0]), p1 = toPt(ptIds[1]);
    let left: number, right: number;
    if (first.vertical) {
      // walking down (+y): left = east pixel; walking up: left = west pixel
      if (p1.y > p0.y) { left = first.lb; right = first.la; }
      else { left = first.la; right = first.lb; }
    } else {
      // walking east (+x): left = north pixel; walking west: left = south
      if (p1.x > p0.x) { left = first.la; right = first.lb; }
      else { left = first.lb; right = first.la; }
    }
    const pts = ptIds.map(toPt);
    const end = ptIds[ptIds.length - 1];
    nodes.set(start, toPt(start));
    nodes.set(end, toPt(end));
    arcs.push({ a: start, b: end, pts, left, right });
  };

  // trace from every node
  for (const pt of isNode) {
    for (const c of incident.get(pt) ?? []) {
      if (!visited[c]) walk(pt, c);
    }
  }
  // leftover closed loops with no junction: anchor one node and trace
  for (let c = 0; c < cracks.length; c++) {
    if (!visited[c]) {
      const start = cracks[c].pA;
      isNode.add(start);
      walk(start, c);
    }
  }

  return { arcs, nodes, width: w, height: h };
}
