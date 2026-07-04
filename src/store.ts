"use client";

// App state. The PatternGraph is a mutable structure; every edit goes through
// applyEdit() which snapshots for undo, mutates, then rebuilds faces so the
// UI (and warnings) always reflect the true shared-edge topology.

import { create } from "zustand";
import type { Face, PatternGraph, PieceWarning, Settings } from "./lib/types";
import { DEFAULT_SETTINGS, unitToMm } from "./lib/types";
import type { RGBImage } from "./lib/pipeline/preprocess";
import { generatePattern } from "./lib/pipeline";
import {
  graphFromJSON, graphToJSON, rebuildFaces, type GraphJSON,
} from "./lib/graph";

export type Tool = "select" | "draw" | "erase";

interface AppState {
  settings: Settings;
  image: RGBImage | null;
  imageName: string;
  graph: PatternGraph | null;
  faces: Face[];
  warnings: PieceWarning[];
  version: number; // bumped on every graph change to trigger re-render
  tool: Tool;
  selectedRegion: number | null;
  selectedArc: number | null;
  generating: boolean;
  undoStack: GraphJSON[];
  view: "editor" | "plan";

  setSettings: (s: Partial<Settings>) => void;
  setImage: (img: RGBImage, name: string) => void;
  setTool: (t: Tool) => void;
  setView: (v: "editor" | "plan") => void;
  select: (regionId: number | null, arcId?: number | null) => void;
  generate: () => void;
  /** snapshot -> mutate -> rebuild faces */
  applyEdit: (fn: (g: PatternGraph) => void) => void;
  /** mutate without snapshot (during drags); call beginDrag first */
  applyLive: (fn: (g: PatternGraph) => void) => void;
  /** geometry-only mutation during drag: no face rebuild (points are shared
   * by reference, so paths update); finishDrag() runs the real rebuild */
  applyGeometry: (fn: (g: PatternGraph) => void) => void;
  finishDrag: () => void;
  beginDrag: () => void;
  undo: () => void;
}

export function pxToMmScale(settings: Settings, graph: PatternGraph): number {
  const wMm = settings.widthValue * unitToMm(settings.units);
  return wMm / graph.width;
}

export const useApp = create<AppState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  image: null,
  imageName: "",
  graph: null,
  faces: [],
  warnings: [],
  version: 0,
  tool: "select",
  selectedRegion: null,
  selectedArc: null,
  generating: false,
  undoStack: [],
  view: "editor",

  setSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s } })),
  setImage: (img, name) => set({ image: img, imageName: name }),
  setTool: (t) => set({ tool: t, selectedRegion: null, selectedArc: null }),
  setView: (v) => set({ view: v }),
  select: (regionId, arcId = null) =>
    set({ selectedRegion: regionId, selectedArc: arcId ?? null }),

  generate: () => {
    const { image, settings } = get();
    if (!image) return;
    set({ generating: true });
    // yield a frame so the busy indicator paints before the CPU burst
    setTimeout(() => {
      try {
        const aspect =
          (settings.widthValue * unitToMm(settings.units)) /
          (settings.heightValue * unitToMm(settings.units));
        const graph = generatePattern({
          image,
          colorCount: settings.colorCount,
          density: settings.density,
          aspect,
        });
        const { faces, warnings } = rebuildFaces(graph, {
          pxToMm: pxToMmScale(settings, graph),
        });
        set({
          graph, faces, warnings,
          version: get().version + 1,
          undoStack: [],
          selectedRegion: null,
          selectedArc: null,
          generating: false,
        });
      } catch (e) {
        console.error(e);
        set({ generating: false });
        alert("Pattern generation failed: " + (e as Error).message);
      }
    }, 30);
  },

  applyEdit: (fn) => {
    const { graph, settings, undoStack } = get();
    if (!graph) return;
    const snap = graphToJSON(graph);
    fn(graph);
    const { faces, warnings } = rebuildFaces(graph, {
      pxToMm: pxToMmScale(settings, graph),
    });
    set({
      faces, warnings,
      version: get().version + 1,
      undoStack: [...undoStack.slice(-49), snap],
    });
  },

  beginDrag: () => {
    const { graph, undoStack } = get();
    if (!graph) return;
    set({ undoStack: [...undoStack.slice(-49), graphToJSON(graph)] });
  },

  applyLive: (fn) => {
    const { graph, settings } = get();
    if (!graph) return;
    fn(graph);
    const { faces, warnings } = rebuildFaces(graph, {
      pxToMm: pxToMmScale(settings, graph),
    });
    set({ faces, warnings, version: get().version + 1 });
  },

  applyGeometry: (fn) => {
    const { graph } = get();
    if (!graph) return;
    fn(graph);
    set({ version: get().version + 1 });
  },

  finishDrag: () => {
    const { graph, settings } = get();
    if (!graph) return;
    const { faces, warnings } = rebuildFaces(graph, {
      pxToMm: pxToMmScale(settings, graph),
    });
    set({ faces, warnings, version: get().version + 1 });
  },

  undo: () => {
    const { undoStack, settings } = get();
    if (undoStack.length === 0) return;
    const snap = undoStack[undoStack.length - 1];
    const graph = graphFromJSON(snap);
    const { faces, warnings } = rebuildFaces(graph, {
      pxToMm: pxToMmScale(settings, graph),
    });
    set({
      graph, faces, warnings,
      undoStack: undoStack.slice(0, -1),
      version: get().version + 1,
      selectedRegion: null,
      selectedArc: null,
    });
  },
}));
