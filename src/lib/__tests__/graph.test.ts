import { describe, it, expect } from "vitest";
import { connectedComponents, splitHoles, mergeSmallRegions } from "../pipeline/regions";
import { traceBoundaries } from "../pipeline/trace";
import { buildGraph, rebuildFaces, deleteArc, addLine } from "../graph";
import type { PaletteColor } from "../types";

const palette: PaletteColor[] = [
  { hex: "#ff0000", rgb: [255, 0, 0], directional: false },
  { hex: "#0000ff", rgb: [0, 0, 255], directional: false },
  { hex: "#00ff00", rgb: [0, 255, 0], directional: false },
];

function mapFromRows(rows: string[]): { colorOf: Int32Array; w: number; h: number } {
  const h = rows.length, w = rows[0].length;
  const colorOf = new Int32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) colorOf[y * w + x] = Number(rows[y][x]);
  return { colorOf, w, h };
}

function graphFromRows(rows: string[]) {
  const { colorOf, w, h } = mapFromRows(rows);
  const rm = splitHoles(connectedComponents(colorOf, w, h));
  const traced = traceBoundaries(rm);
  return buildGraph(traced, palette, rm.regionColor);
}

describe("planar subdivision", () => {
  it("two half regions -> two faces, shared edge, exact areas", () => {
    const g = graphFromRows(["0011", "0011", "0011", "0011"]);
    const { faces, warnings } = rebuildFaces(g);
    expect(faces.length).toBe(2);
    const areas = faces.map((f) => f.area).sort((a, b) => a - b);
    expect(areas).toEqual([8, 8]);
    expect(faces.every((f) => f.holes.length === 0)).toBe(true);
    expect(warnings.filter((w) => w.kind === "hole")).toHaveLength(0);
    // exactly one interior arc, shared by the two regions
    const interior = [...g.arcs.values()].filter((a) => a.left >= 0 && a.right >= 0);
    expect(interior.length).toBe(1);
  });

  it("deleting the shared line merges the two pieces with no gap", () => {
    const g = graphFromRows(["0011", "0011", "0011", "0011"]);
    rebuildFaces(g);
    const interior = [...g.arcs.values()].find((a) => a.left >= 0 && a.right >= 0)!;
    expect(deleteArc(g, interior.id)).toBe(true);
    const { faces } = rebuildFaces(g);
    expect(faces.length).toBe(1);
    // gap-free: merged face covers the FULL panel area exactly
    expect(faces[0].area).toBe(16);
    expect(faces[0].holes.length).toBe(0);
  });

  it("border arcs cannot be deleted", () => {
    const g = graphFromRows(["0011", "0011", "0011", "0011"]);
    const border = [...g.arcs.values()].find((a) => a.left === -1 || a.right === -1)!;
    expect(deleteArc(g, border.id)).toBe(false);
  });

  it("splitHoles: enclosed region no longer yields an annular piece", () => {
    const rows = ["00000", "00000", "00100", "00000", "00000"];
    const { colorOf, w, h } = mapFromRows(rows);
    const noSplit = connectedComponents(colorOf, w, h);
    expect(noSplit.count).toBe(2); // ring + center — ring is annular
    const rm = splitHoles(noSplit);
    expect(rm.count).toBe(3); // ring split into two + center
    const g = graphFromRows(rows);
    const { faces, warnings } = rebuildFaces(g, { sliverAreaMm2: 0 });
    expect(faces.length).toBe(3);
    expect(warnings.filter((wn) => wn.kind === "hole")).toHaveLength(0);
    // total area preserved
    expect(faces.reduce((s, f) => s + f.area, 0)).toBe(25);
  });

  it("editor merge that re-creates an annulus is detected as a hole warning", () => {
    const g = graphFromRows(["00000", "00000", "00100", "00000", "00000"]);
    rebuildFaces(g);
    // merge the two ring halves back together -> annulus around center
    const ringArcs = [...g.arcs.values()].filter((a) => {
      if (a.left < 0 || a.right < 0 || a.left === a.right) return false;
      const cl = g.regions.get(a.left)!.colorIdx;
      const cr = g.regions.get(a.right)!.colorIdx;
      return cl === 0 && cr === 0;
    });
    expect(ringArcs.length).toBe(2);
    deleteArc(g, ringArcs[0].id);
    const { faces, warnings } = rebuildFaces(g, { sliverAreaMm2: 0 });
    const ring = faces.find((f) => f.holes.length > 0);
    expect(ring).toBeDefined();
    expect(ring!.area).toBe(24);
    expect(warnings.some((w) => w.kind === "hole")).toBe(true);
  });

  it("addLine splits a piece into two, preserving total area", () => {
    const g = graphFromRows(["0000", "0000", "0000", "0000"]);
    const r0 = rebuildFaces(g);
    expect(r0.faces.length).toBe(1);
    const regionId = r0.faces[0].regionId;
    // find top border arc (y=0) and bottom border arc (y=4)
    const arcs = [...g.arcs.values()];
    const top = arcs.find((a) => a.pts.every((p) => p.y === 0))!;
    const bottom = arcs.find((a) => a.pts.every((p) => p.y === 4))!;
    expect(top).toBeDefined();
    expect(bottom).toBeDefined();
    const topSeg = top.pts.findIndex((p, i) => i < top.pts.length - 1 && Math.min(top.pts[i].x, top.pts[i + 1].x) <= 2 && Math.max(top.pts[i].x, top.pts[i + 1].x) >= 2);
    const botSeg = bottom.pts.findIndex((p, i) => i < bottom.pts.length - 1 && Math.min(bottom.pts[i].x, bottom.pts[i + 1].x) <= 2 && Math.max(bottom.pts[i].x, bottom.pts[i + 1].x) >= 2);
    addLine(
      g, regionId,
      { arcId: top.id, segIdx: topSeg, t: 0.5, p: { x: 2, y: 0 } },
      { arcId: bottom.id, segIdx: botSeg, t: 0.5, p: { x: 2, y: 4 } },
      0.5
    );
    const { faces } = rebuildFaces(g);
    expect(faces.length).toBe(2);
    expect(faces.reduce((s, f) => s + f.area, 0)).toBe(16);
    expect(faces.map((f) => f.area).sort((a, b) => a - b)).toEqual([8, 8]);
    // the two faces must be distinct regions but the same color
    expect(faces[0].regionId).not.toBe(faces[1].regionId);
    const c0 = g.regions.get(faces[0].regionId)!.colorIdx;
    const c1 = g.regions.get(faces[1].regionId)!.colorIdx;
    expect(c0).toBe(c1);
  });

  it("small regions merge into most color-similar neighbor", () => {
    // tiny green speck inside red field, blue right half
    const rows = ["000111", "020111", "000111"];
    const { colorOf, w, h } = mapFromRows(rows);
    let rm = connectedComponents(colorOf, w, h);
    expect(rm.count).toBe(3);
    rm = mergeSmallRegions(rm, 3, palette);
    expect(rm.count).toBe(2); // speck absorbed
  });
});
