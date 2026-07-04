// Region map construction: connected components over the quantized color map,
// minimum-piece-size merging (density knob), and hole-splitting so every
// piece is simply connected (cuttable).

import { labDist2, srgbToLab } from "../color";
import type { PaletteColor } from "../types";

export interface RegionMap {
  width: number;
  height: number;
  /** region id per pixel, 0..count-1 */
  regions: Int32Array;
  /** palette color index per region */
  regionColor: Int32Array;
  count: number;
}

/** 4-connected components over per-pixel color indices. */
export function connectedComponents(
  colorOf: Int32Array,
  w: number,
  h: number
): RegionMap {
  const regions = new Int32Array(w * h).fill(-1);
  const colors: number[] = [];
  let count = 0;
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (regions[start] !== -1) continue;
    const color = colorOf[start];
    const id = count++;
    colors.push(color);
    let sp = 0;
    stack[sp++] = start;
    regions[start] = id;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && regions[i - 1] === -1 && colorOf[i - 1] === color) { regions[i - 1] = id; stack[sp++] = i - 1; }
      if (x < w - 1 && regions[i + 1] === -1 && colorOf[i + 1] === color) { regions[i + 1] = id; stack[sp++] = i + 1; }
      if (y > 0 && regions[i - w] === -1 && colorOf[i - w] === color) { regions[i - w] = id; stack[sp++] = i - w; }
      if (y < h - 1 && regions[i + w] === -1 && colorOf[i + w] === color) { regions[i + w] = id; stack[sp++] = i + w; }
    }
  }
  return { width: w, height: h, regions, regionColor: Int32Array.from(colors), count };
}

function buildAdjacency(rm: RegionMap): Array<Set<number>> {
  const { width: w, height: h, regions, count } = rm;
  const adj: Array<Set<number>> = Array.from({ length: count + 1 }, () => new Set());
  const OUT = count; // virtual "outside" node
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = regions[i];
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) {
        adj[r].add(OUT); adj[OUT].add(r);
      }
      if (x < w - 1 && regions[i + 1] !== r) { adj[r].add(regions[i + 1]); adj[regions[i + 1]].add(r); }
      if (y < h - 1 && regions[i + w] !== r) { adj[r].add(regions[i + w]); adj[regions[i + w]].add(r); }
    }
  }
  return adj;
}

/** Merge every region smaller than minSize into its most color-similar
 * neighbor (CIELAB distance between palette colors). Repeats until stable. */
export function mergeSmallRegions(
  rm: RegionMap,
  minSize: number,
  palette: PaletteColor[]
): RegionMap {
  const labs = palette.map((p) => srgbToLab(...p.rgb));
  let cur = rm;
  for (let pass = 0; pass < 30; pass++) {
    const { width: w, height: h, regions, regionColor, count } = cur;
    const sizes = new Int32Array(count);
    for (let i = 0; i < regions.length; i++) sizes[regions[i]]++;
    const adj = buildAdjacency(cur);

    // union-find
    const parent = new Int32Array(count);
    for (let i = 0; i < count; i++) parent[i] = i;
    const find = (x: number): number => {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    };

    const order = Array.from({ length: count }, (_, i) => i).sort(
      (a, b) => sizes[a] - sizes[b]
    );
    const mergedColor = Int32Array.from(regionColor);
    let merged = 0;
    for (const r of order) {
      if (sizes[r] >= minSize) break;
      if (find(r) !== r) continue; // already absorbed
      let best = -1, bestD = Infinity;
      for (const nRaw of adj[r]) {
        if (nRaw === count) continue; // outside
        const n = find(nRaw);
        if (n === r) continue;
        const d = labDist2(labs[mergedColor[r]] as [number, number, number], labs[mergedColor[n]] as [number, number, number]);
        if (d < bestD) { bestD = d; best = n; }
      }
      if (best >= 0) {
        parent[r] = best;
        mergedColor[r] = mergedColor[best];
        merged++;
      }
    }
    if (merged === 0) return cur;

    // rewrite pixel colors from merged roots, then re-run CC so adjacency,
    // sizes and region ids are clean for the next pass
    const colorOf = new Int32Array(w * h);
    for (let i = 0; i < regions.length; i++) colorOf[i] = mergedColor[find(regions[i])];
    cur = connectedComponents(colorOf, w, h);
  }
  return cur;
}

/** Split annular regions so every piece is simply connected.
 * A region P has a hole iff removing it from the adjacency graph disconnects
 * some region from the outside. We split P with a vertical line through a
 * hole pixel; connected components are then recomputed. */
export function splitHoles(rm: RegionMap): RegionMap {
  let cur = rm;
  for (let iter = 0; iter < 25; iter++) {
    const { width: w, height: h, regions, regionColor, count } = cur;
    const adj = buildAdjacency(cur);
    const OUT = count;

    let holeRegion = -1; // a region trapped inside some P
    let annular = -1; // the P that surrounds it
    outer: for (let p = 0; p < count; p++) {
      if (!adj[p].size) continue;
      // BFS from OUT skipping p
      const seen = new Uint8Array(count + 1);
      seen[p] = 1; seen[OUT] = 1;
      const queue = [OUT];
      while (queue.length) {
        const u = queue.pop()!;
        for (const v of adj[u]) if (!seen[v]) { seen[v] = 1; queue.push(v); }
      }
      for (let q = 0; q < count; q++) {
        if (!seen[q]) { holeRegion = q; annular = p; break outer; }
      }
    }
    if (annular < 0) return cur;

    // find a pixel of the hole region -> cut column
    let cx = -1;
    for (let i = 0; i < regions.length; i++) {
      if (regions[i] === holeRegion) { cx = i % w; break; }
    }
    // split the annular region by the vertical line x >= cx
    const colorOf = new Int32Array(w * h);
    const newColorIdx = regionColor[annular];
    // use a temporary distinct "color" so CC separates the two halves, then
    // both halves keep the same palette color
    const TMP = 1 << 20;
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i];
      colorOf[i] = r === annular && i % w >= cx ? TMP + newColorIdx : regionColor[r];
    }
    const next = connectedComponents(colorOf, w, h);
    for (let r = 0; r < next.count; r++) {
      if (next.regionColor[r] >= TMP) next.regionColor[r] -= TMP;
    }
    cur = next;
  }
  return cur;
}

/** Density knob -> minimum piece size in pixels. */
export function minPieceSize(
  density: "low" | "medium" | "high",
  w: number,
  h: number
): number {
  const total = w * h;
  const frac = density === "low" ? 1 / 90 : density === "medium" ? 1 / 350 : 1 / 1400;
  return Math.max(30, Math.round(total * frac));
}
