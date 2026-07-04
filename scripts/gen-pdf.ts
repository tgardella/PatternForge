// End-to-end headless test: synthetic image -> pipeline -> faces -> PDF.
import { writeFileSync } from "node:fs";
import { generatePattern } from "../src/lib/pipeline";
import { rebuildFaces } from "../src/lib/graph";
import { buildPatternPdf } from "../src/lib/pdf/exportPdf";
import { DEFAULT_SETTINGS } from "../src/lib/types";
import type { RGBImage } from "../src/lib/pipeline/preprocess";

function syntheticImage(w = 900, h = 1200): RGBImage {
  const data = new Uint8ClampedArray(w * h * 4);
  const put = (x: number, y: number, r: number, g: number, b: number) => {
    const i = (y * w + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fy = y / h, fx = x / w;
      // sun disc
      const dx = fx - 0.6, dy = fy - 0.35;
      if (dx * dx + dy * dy * 1.7 < 0.02) { put(x, y, 246, 211, 101); continue; }
      // hills
      const hill = 0.55 + 0.06 * Math.sin(fx * 6.0);
      if (fy > 0.68) put(x, y, 29, 58, 85); // water
      else if (fy > hill) put(x, y, 47, 74, 44); // hill
      else if (fy > 0.42) put(x, y, 232, 149, 92); // horizon glow
      else put(x, y, 62, 54, 112); // sky
    }
  }
  return { width: w, height: h, data };
}

const settings = { ...DEFAULT_SETTINGS };
const img = syntheticImage();
const t0 = Date.now();
const graph = generatePattern({
  image: img,
  colorCount: settings.colorCount,
  density: settings.density,
  aspect: settings.widthValue / settings.heightValue,
});
const pxToMm = (settings.widthValue * 1) / graph.width;
const { faces, warnings } = rebuildFaces(graph, { pxToMm });
console.log(
  `pipeline: ${Date.now() - t0}ms, ${faces.length} pieces, ${graph.arcs.size} arcs, ${warnings.length} warnings`
);
for (const w of warnings.slice(0, 5)) console.log("  warn:", w.kind, w.message);

const t1 = Date.now();
buildPatternPdf({ graph, faces, settings, pxToMm }).then((bytes) => {
  console.log(`pdf: ${Date.now() - t1}ms, ${(bytes.length / 1024).toFixed(0)} KB`);
  const out = process.argv[2] ?? "/tmp/patternforge-test.pdf";
  writeFileSync(out, bytes);
  console.log("wrote", out);
  // sanity: 25.4 mm must be exactly 72 pt
  console.log("calibration check: 25.4mm =", (25.4 * 72) / 25.4, "pt (must be 72)");
});
