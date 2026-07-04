// The deterministic generation pipeline:
// image -> downscale/denoise -> k-means (CIELAB) -> regions -> merge small
// -> split holes -> trace shared-edge planar subdivision -> simplify -> graph

import { cropToAspect, downscale, medianDenoise, type RGBImage } from "./preprocess";
import { quantize } from "./quantize";
import {
  connectedComponents, mergeSmallRegions, minPieceSize, splitHoles,
} from "./regions";
import { traceBoundaries } from "./trace";
import { simplifyArcs } from "./simplify";
import { buildGraph } from "../graph";
import type { PatternGraph, Settings } from "../types";

export interface PipelineInput {
  image: RGBImage;
  colorCount: number;
  density: Settings["density"];
  smoothness?: Settings["smoothness"];
  /** finished W/H — image is center-cropped to this aspect ratio */
  aspect: number;
}

export function generatePattern(input: PipelineInput): PatternGraph {
  const img = medianDenoise(downscale(cropToAspect(input.image, input.aspect)));
  const { labels, palette } = quantize(img, input.colorCount);

  let rm = connectedComponents(labels, img.width, img.height);
  const minSize = minPieceSize(input.density, img.width, img.height);

  // merging can create annuli and splitting can create small pieces, so
  // alternate a few rounds; ALWAYS finish with splitHoles (no-holes invariant)
  for (let round = 0; round < 3; round++) {
    rm = mergeSmallRegions(rm, minSize, palette);
    rm = splitHoles(rm);
  }

  const traced = traceBoundaries(rm);
  traced.arcs = simplifyArcs(traced.arcs, input.smoothness ?? "smooth");
  return buildGraph(traced, palette, rm.regionColor);
}
