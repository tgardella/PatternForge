// PatternGraph: the editable shared-edge planar subdivision, plus face
// reconstruction and topology edits (delete line = merge, add line = split).
//
// Faces are always REBUILT from the arcs after any change — the graph stays
// gap-free by construction because both sides of every boundary render the
// same arc polyline.

import type {
  Arc, Face, FaceLoop, GNode, PatternGraph, PieceWarning, Pt,
} from "./types";
import type { TraceResult } from "./pipeline/trace";
import type { PaletteColor } from "./types";
import {
  poleOfInaccessibility, signedArea, pointInPolygon, worstReflexAngle,
  polygonPerimeter,
} from "./geometry";

export function buildGraph(
  tr: TraceResult,
  palette: PaletteColor[],
  regionColor: Int32Array
): PatternGraph {
  const g: PatternGraph = {
    nodes: new Map(),
    arcs: new Map(),
    regions: new Map(),
    palette,
    width: tr.width,
    height: tr.height,
    nextId: 1,
  };
  const nodeIdByLattice = new Map<number, number>();
  for (const [latticeId, p] of tr.nodes) {
    const id = g.nextId++;
    nodeIdByLattice.set(latticeId, id);
    g.nodes.set(id, { id, p: { ...p } });
  }
  const usedRegions = new Set<number>();
  for (const ta of tr.arcs) {
    const id = g.nextId++;
    g.arcs.set(id, {
      id,
      a: nodeIdByLattice.get(ta.a)!,
      b: nodeIdByLattice.get(ta.b)!,
      pts: ta.pts.map((p) => ({ ...p })),
      left: ta.left,
      right: ta.right,
    });
    if (ta.left >= 0) usedRegions.add(ta.left);
    if (ta.right >= 0) usedRegions.add(ta.right);
  }
  for (const r of usedRegions) {
    g.regions.set(r, { id: r, colorIdx: regionColor[r] });
    g.nextId = Math.max(g.nextId, r + 1);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Face reconstruction via angular half-edge walk
// ---------------------------------------------------------------------------

/** halfedge id = arcId*2 (forward: a->b) or arcId*2+1 (reverse: b->a) */
function heArc(he: number): number { return he >> 1; }
function heForward(he: number): boolean { return (he & 1) === 0; }
function heTwin(he: number): number { return he ^ 1; }

function heOrigin(g: PatternGraph, he: number): number {
  const arc = g.arcs.get(heArc(he))!;
  return heForward(he) ? arc.a : arc.b;
}

function heDepartureAngle(g: PatternGraph, he: number): number {
  const arc = g.arcs.get(heArc(he))!;
  const pts = arc.pts;
  let p0: Pt, p1: Pt;
  if (heForward(he)) {
    p0 = pts[0];
    p1 = pts[1] ?? pts[pts.length - 1];
    // skip coincident points
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].x !== p0.x || pts[i].y !== p0.y) { p1 = pts[i]; break; }
    }
  } else {
    p0 = pts[pts.length - 1];
    p1 = pts[pts.length - 2] ?? pts[0];
    for (let i = pts.length - 2; i >= 0; i--) {
      if (pts[i].x !== p0.x || pts[i].y !== p0.y) { p1 = pts[i]; break; }
    }
  }
  return Math.atan2(p1.y - p0.y, p1.x - p0.x);
}

export interface RebuildResult {
  faces: Face[];
  warnings: PieceWarning[];
}

/** Options: pxToMm scales warnings thresholds into real units. */
export interface RebuildOptions {
  pxToMm?: number; // mm per graph unit
  sliverAreaMm2?: number;
  reflexLimitDeg?: number;
  /** called when a region must be split into two after addLine */
  onRegionSplit?: (oldId: number, newId: number) => void;
}

export function rebuildFaces(g: PatternGraph, opts: RebuildOptions = {}): RebuildResult {
  const pxToMm = opts.pxToMm ?? 1;
  const sliverAreaMm2 = opts.sliverAreaMm2 ?? 150;
  const reflexLimitDeg = opts.reflexLimitDeg ?? 285;

  // group departing halfedges per node, sorted by angle
  const departing = new Map<number, number[]>();
  for (const arc of g.arcs.values()) {
    for (const he of [arc.id * 2, arc.id * 2 + 1]) {
      const o = heOrigin(g, he);
      let l = departing.get(o);
      if (!l) departing.set(o, (l = []));
      l.push(he);
    }
  }
  for (const [node, list] of departing) {
    const withAngle = list.map((he) => ({ he, ang: heDepartureAngle(g, he) }));
    withAngle.sort((a, b) => a.ang - b.ang);
    departing.set(node, withAngle.map((x) => x.he));
  }

  // next(h): at the node where h arrives, take the twin and rotate
  const next = (he: number): number => {
    const t = heTwin(he);
    const v = heOrigin(g, t);
    const list = departing.get(v)!;
    const idx = list.indexOf(t);
    // rotate to the next halfedge in ascending-angle order; with y-down
    // screen coordinates this traces bounded faces so that the face interior
    // lies to the LEFT of each halfedge's travel direction.
    return list[(idx + 1) % list.length];
  };

  // trace loops
  const loopOf = new Map<number, number>(); // he -> loop index
  const loops: { hes: number[]; pts: Pt[]; area: number }[] = [];
  for (const arc of g.arcs.values()) {
    for (const he0 of [arc.id * 2, arc.id * 2 + 1]) {
      if (loopOf.has(he0)) continue;
      const hes: number[] = [];
      let he = he0;
      let guard = 0;
      do {
        loopOf.set(he, loops.length);
        hes.push(he);
        he = next(he);
      } while (he !== he0 && ++guard < 1_000_000);
      const pts: Pt[] = [];
      for (const h of hes) {
        const a = g.arcs.get(heArc(h))!;
        const seq = heForward(h) ? a.pts : [...a.pts].reverse();
        for (let i = 0; i < seq.length - 1; i++) pts.push(seq[i]);
      }
      loops.push({ hes, pts, area: signedArea(pts) });
    }
  }

  // vote each loop's region from arc side labels ("face on the left")
  const loopRegion: number[] = loops.map((loop) => {
    const votes = new Map<number, number>();
    for (const h of loop.hes) {
      const a = g.arcs.get(heArc(h))!;
      const side = heForward(h) ? a.left : a.right;
      votes.set(side, (votes.get(side) ?? 0) + 1);
    }
    let best = -1, bestN = -1;
    for (const [r, n] of votes) if (n > bestN) { bestN = n; best = r; }
    return best;
  });

  // Determine outer-boundary sign: the outside face (-1) has exactly one loop
  // that is the panel border; bounded faces have the opposite area sign.
  // With our tracing convention bounded outer loops share one sign.
  // Group loops by region.
  const byRegion = new Map<number, number[]>();
  loops.forEach((_, i) => {
    const r = loopRegion[i];
    let l = byRegion.get(r);
    if (!l) byRegion.set(r, (l = []));
    l.push(i);
  });

  // sign of bounded outer loops = sign of the largest-|area| loop that is NOT
  // the outside region's
  let outerSign = 0;
  {
    let bestA = 0;
    for (let i = 0; i < loops.length; i++) {
      if (loopRegion[i] === -1) continue;
      if (Math.abs(loops[i].area) > Math.abs(bestA)) bestA = loops[i].area;
    }
    outerSign = Math.sign(bestA) || 1;
  }

  const faces: Face[] = [];
  const warnings: PieceWarning[] = [];

  for (const [regionId, loopIdxs] of byRegion) {
    if (regionId === -1) continue;
    const outers = loopIdxs.filter((i) => Math.sign(loops[i].area) === outerSign);
    const holes = loopIdxs.filter((i) => Math.sign(loops[i].area) !== outerSign);

    // region split into several disjoint faces (e.g. after addLine):
    // keep the original id on the largest, mint new region ids for the rest
    outers.sort((a, b) => Math.abs(loops[b].area) - Math.abs(loops[a].area));
    const faceRegionIds: number[] = [];
    outers.forEach((loopIdx, k) => {
      if (k === 0) faceRegionIds.push(regionId);
      else {
        const newId = g.nextId++;
        const src = g.regions.get(regionId);
        g.regions.set(newId, { id: newId, colorIdx: src ? src.colorIdx : 0 });
        opts.onRegionSplit?.(regionId, newId);
        faceRegionIds.push(newId);
        loopRegion[loopIdx] = newId;
      }
    });

    outers.forEach((loopIdx, k) => {
      const rid = faceRegionIds[k];
      const outerLoop = loops[loopIdx];
      // holes assigned to the outer loop that contains them
      const myHoles = holes.filter((hi) => {
        const p = loops[hi].pts[0];
        return pointInPolygon(p, outerLoop.pts);
      });
      const holeLoops: FaceLoop[] = myHoles.map((hi) => ({
        arcRefs: loops[hi].hes.map((h) => (heForward(h) ? heArc(h) : -heArc(h))),
        pts: loops[hi].pts,
        area: Math.abs(loops[hi].area),
      }));
      const area =
        Math.abs(outerLoop.area) - holeLoops.reduce((s, l) => s + l.area, 0);
      const face: Face = {
        regionId: rid,
        outer: {
          arcRefs: outerLoop.hes.map((h) => (heForward(h) ? heArc(h) : -heArc(h))),
          pts: outerLoop.pts,
          area: Math.abs(outerLoop.area),
        },
        holes: holeLoops,
        area,
        labelPos: poleOfInaccessibility(outerLoop.pts, holeLoops.map((l) => l.pts)),
      };
      faces.push(face);

      // ---- warnings ----
      const mm2 = area * pxToMm * pxToMm;
      if (holeLoops.length > 0) {
        warnings.push({
          regionId: rid, kind: "hole",
          message: `Piece has ${holeLoops.length} hole(s) — glass cannot be cut with interior holes. Add a line to split it.`,
        });
      }
      if (mm2 < sliverAreaMm2) {
        warnings.push({
          regionId: rid, kind: "sliver",
          message: `Very small piece (≈${Math.max(1, Math.round(mm2))} mm²) — hard to cut and to hold in came/foil. Consider deleting a line to merge it.`,
        });
      } else {
        // thinness: mean width ~ 2*area/perimeter
        const perim = polygonPerimeter(outerLoop.pts) * pxToMm;
        const meanW = (2 * mm2) / Math.max(perim, 1e-6);
        if (meanW < 4) {
          warnings.push({
            regionId: rid, kind: "sliver",
            message: `Sliver piece (mean width ≈${meanW.toFixed(1)} mm) — likely to crack while cutting.`,
          });
        }
      }
      const reflex = worstReflexAngle(outerLoop.pts);
      if (reflex !== null && reflex > reflexLimitDeg) {
        warnings.push({
          regionId: rid, kind: "concave",
          message: `Deep concave notch (interior angle ≈${Math.round(reflex)}°) — hard to cut; score-and-groze carefully or split the piece.`,
        });
      }
    });

    // write side labels back so arcs stay consistent after edits
    for (const loopIdx of loopIdxs) {
      const rid = loopRegion[loopIdx];
      for (const h of loops[loopIdx].hes) {
        const a = g.arcs.get(heArc(h))!;
        if (heForward(h)) a.left = rid;
        else a.right = rid;
      }
    }
  }

  // prune regions that no longer own any face
  const live = new Set(faces.map((f) => f.regionId));
  for (const id of [...g.regions.keys()]) {
    if (!live.has(id)) g.regions.delete(id);
  }

  faces.sort(
    (a, b) => a.labelPos.y - b.labelPos.y || a.labelPos.x - b.labelPos.x
  );
  return { faces, warnings };
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

/** Delete an arc: merges its two pieces. Returns false if it borders the
 * outside (the panel outline cannot be deleted). `winner` picks the color. */
export function deleteArc(
  g: PatternGraph,
  arcId: number,
  winner?: "left" | "right"
): boolean {
  const arc = g.arcs.get(arcId);
  if (!arc) return false;
  if (arc.left < 0 || arc.right < 0) return false;
  if (arc.left === arc.right) { g.arcs.delete(arcId); return true; }
  const keep = winner === "right" ? arc.right : arc.left;
  const drop = winner === "right" ? arc.left : arc.right;
  g.arcs.delete(arcId);
  for (const a of g.arcs.values()) {
    if (a.left === drop) a.left = keep;
    if (a.right === drop) a.right = keep;
  }
  // arcs that now separate a region from itself are interior slits: remove
  for (const a of [...g.arcs.values()]) {
    if (a.left === a.right) g.arcs.delete(a.id);
  }
  g.regions.delete(drop);
  pruneOrphanNodes(g);
  return true;
}

function pruneOrphanNodes(g: PatternGraph) {
  const used = new Set<number>();
  for (const a of g.arcs.values()) { used.add(a.a); used.add(a.b); }
  for (const id of [...g.nodes.keys()]) if (!used.has(id)) g.nodes.delete(id);
}

/** A point on an arc: segment index + parameter t in [0,1]. */
export interface ArcHit {
  arcId: number;
  segIdx: number;
  t: number;
  p: Pt;
}

/** Split an arc at a hit point, inserting a node. Returns the node id.
 * Reuses an existing endpoint node if the hit is within `snap` of it. */
export function splitArcAt(g: PatternGraph, hit: ArcHit, snap = 3): number {
  const arc = g.arcs.get(hit.arcId)!;
  const pts = arc.pts;
  const p = hit.p;
  const dA = Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  const dB = Math.hypot(p.x - pts[pts.length - 1].x, p.y - pts[pts.length - 1].y);
  if (dA <= snap && arc.a !== arc.b) return arc.a;
  if (dB <= snap && arc.a !== arc.b) return arc.b;

  const nodeId = g.nextId++;
  g.nodes.set(nodeId, { id: nodeId, p: { ...p } });

  const before = pts.slice(0, hit.segIdx + 1).concat([{ ...p }]);
  const after = [{ ...p }].concat(pts.slice(hit.segIdx + 1));

  if (arc.a === arc.b) {
    // closed loop: rotate so it starts/ends at the new node
    const ring = pts.slice(0, -1); // drop duplicated closing point
    const seq: Pt[] = [{ ...p }];
    for (let i = hit.segIdx + 1; i < ring.length; i++) seq.push(ring[i]);
    for (let i = 0; i <= hit.segIdx; i++) seq.push(ring[i]);
    seq.push({ ...p });
    arc.pts = dedupeConsecutive(seq);
    arc.a = nodeId;
    arc.b = nodeId;
    return nodeId;
  }

  const arc2Id = g.nextId++;
  const arc2: Arc = {
    id: arc2Id,
    a: nodeId,
    b: arc.b,
    pts: dedupeConsecutive(after),
    left: arc.left,
    right: arc.right,
  };
  arc.pts = dedupeConsecutive(before);
  arc.b = nodeId;
  g.arcs.set(arc2Id, arc2);
  return nodeId;
}

function dedupeConsecutive(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-9) out.push(p);
  }
  if (out.length < 2) out.push({ ...pts[pts.length - 1] });
  return out;
}

/** Add a line splitting a piece: both hits must lie on the boundary of the
 * same region. Creates the connecting arc; the region split itself is
 * resolved by the next rebuildFaces() call. Returns the new arc id. */
export function addLine(
  g: PatternGraph,
  regionId: number,
  hitA: ArcHit,
  hitB: ArcHit,
  snap = 3
): number {
  const nA = splitArcAt(g, hitA, snap);
  const nB = splitArcAt(g, hitB, snap);
  const pA = g.nodes.get(nA)!.p;
  const pB = g.nodes.get(nB)!.p;
  const arcId = g.nextId++;
  g.arcs.set(arcId, {
    id: arcId,
    a: nA,
    b: nB,
    pts: [{ ...pA }, { ...pB }],
    left: regionId,
    right: regionId,
  });
  return arcId;
}

// NOTE: move ops mutate Pt objects IN PLACE. Face loops hold references to
// the same Pt objects, so dragged geometry re-renders without a face rebuild
// (the rebuild for areas/labels/warnings runs once, on drag end).
export function moveNode(g: PatternGraph, nodeId: number, p: Pt) {
  const node = g.nodes.get(nodeId);
  if (!node) return;
  node.p.x = p.x;
  node.p.y = p.y;
  for (const arc of g.arcs.values()) {
    if (arc.a === nodeId) {
      arc.pts[0].x = p.x;
      arc.pts[0].y = p.y;
    }
    if (arc.b === nodeId) {
      arc.pts[arc.pts.length - 1].x = p.x;
      arc.pts[arc.pts.length - 1].y = p.y;
    }
  }
}

export function moveArcPoint(g: PatternGraph, arcId: number, idx: number, p: Pt) {
  const arc = g.arcs.get(arcId);
  if (!arc) return;
  if (idx <= 0 || idx >= arc.pts.length - 1) return; // endpoints via moveNode
  arc.pts[idx].x = p.x;
  arc.pts[idx].y = p.y;
}

/** Insert a draggable point into an arc segment (for bending lines). */
export function insertArcPoint(g: PatternGraph, arcId: number, segIdx: number, p: Pt): number {
  const arc = g.arcs.get(arcId);
  if (!arc) return -1;
  arc.pts.splice(segIdx + 1, 0, { ...p });
  return segIdx + 1;
}

export function recolor(g: PatternGraph, regionId: number, colorIdx: number) {
  const r = g.regions.get(regionId);
  if (r) r.colorIdx = colorIdx;
}

// ---------------------------------------------------------------------------
// (De)serialization for undo snapshots
// ---------------------------------------------------------------------------

export interface GraphJSON {
  nodes: [number, GNode][];
  arcs: [number, Arc][];
  regions: [number, { id: number; colorIdx: number }][];
  palette: PaletteColor[];
  width: number;
  height: number;
  nextId: number;
}

export function graphToJSON(g: PatternGraph): GraphJSON {
  return JSON.parse(
    JSON.stringify({
      nodes: [...g.nodes.entries()],
      arcs: [...g.arcs.entries()],
      regions: [...g.regions.entries()],
      palette: g.palette,
      width: g.width,
      height: g.height,
      nextId: g.nextId,
    })
  );
}

export function graphFromJSON(j: GraphJSON): PatternGraph {
  return {
    nodes: new Map(j.nodes.map(([k, v]) => [k, { ...v, p: { ...v.p } }])),
    arcs: new Map(
      j.arcs.map(([k, v]) => [k, { ...v, pts: v.pts.map((p) => ({ ...p })) }])
    ),
    regions: new Map(j.regions.map(([k, v]) => [k, { ...v }])),
    palette: j.palette.map((p) => ({ ...p })),
    width: j.width,
    height: j.height,
    nextId: j.nextId,
  };
}
