# PatternForge

Turn a reference image into an **editable, printable, to-scale stained glass
pattern** — entirely in your browser. The image never leaves your machine.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # geometry/topology invariant tests (vitest)
```

## How it works

**Generation pipeline** (deterministic classical CV, pure TypeScript on typed
arrays — no vision model, no server):

1. Center-crop to the finished panel's aspect ratio, downscale to ≤1000 px,
   3×3 median denoise (`src/lib/pipeline/preprocess.ts`).
2. K-means color quantization in **CIELAB** with k-means++ seeding from a
   fixed PRNG seed — same input always gives the same pattern. Each cluster's
   display color is the per-channel **median** of its pixels
   (`src/lib/pipeline/quantize.ts`).
3. Connected components → region map. The density knob sets a minimum piece
   size; smaller regions merge into their most color-similar (ΔLab) neighbor.
   Annular regions are split so **every piece is simply connected** — glass
   can't be cut with a hole in it (`src/lib/pipeline/regions.ts`).
4. Boundaries are extracted as a **planar subdivision** ("crack" tracing):
   every line is one arc shared by exactly two pieces — never two independent
   polygons (`src/lib/pipeline/trace.ts`).
5. Arcs are simplified (Douglas–Peucker) and smoothed (Chaikin) so lead lines
   flow; because arcs are shared, both sides stay perfectly coincident
   (`src/lib/pipeline/simplify.ts`).

> **Note on OpenCV.js:** the spec suggested OpenCV.js (WASM). The same
> classical ops are implemented in TypeScript instead because (a) OpenCV's
> k-means isn't seedable from JS, breaking the determinism requirement, and
> (b) it avoids a ~10 MB WASM download. The pipeline stages are small, pure
> functions behind stable interfaces — swapping OpenCV.js back in later only
> touches `preprocess.ts`/`quantize.ts`.

**Editor** (`src/lib/graph.ts`, `src/components/EditorCanvas.tsx`) operates on
the shared-edge graph, so the panel always stays gap-free and tiling:

- **Select** (V): click a piece; drag line points / junction nodes — both
  adjacent pieces update together. Grab any lead line to bend it. Click a
  palette swatch to recolor the selected piece.
- **+ Line** (L): click two points on a piece's boundary to split it in two.
- **− Line** (E): click a line to merge its two pieces (you pick which color
  wins). Faces are rebuilt from the arcs after every edit; live warnings flag
  holes, slivers, and deep concave notches (hard to cut).
- ⌘Z undo.

**Plan view**: piece count, palette, and a glass-per-color purchase estimate:
`waste = breakage(skill) + nesting(0.6·(1−packing efficiency), capped 35%) +
0.15 if directional/streaky`, rounded up to whole purchase units (default
minimum 1 sq ft), with optional sheet-size and price inputs.

**PDF export** (`src/lib/pdf/exportPdf.ts`): plan page, legend page(s), then
the pattern tiled across Letter/A4 pages **in true millimetres**
(1 mm = 72/25.4 pt, never fit-to-page):

- outlines only, numbered pieces, came allowance applied by insetting each
  piece by half the came width via ClipperJS (no inset for copper foil),
- 15 mm page overlap with dashed match lines, registration crosses printed at
  identical physical positions on both adjacent pages, corner crop marks,
  A1/A2/B1… page grid with neighbor hints,
- a **25.4 mm calibration square** on the plan page and pattern page A1:
  "Print at 100% / Actual Size — must measure exactly 1 inch."

## Dev scripts

- `npx tsx scripts/gen-pdf.ts out.pdf` — headless pipeline + PDF export on a
  synthetic image.
- `node scripts/pdf-to-html.mjs in.pdf out.html` — self-contained pdf.js
  viewer for visually checking the PDF in a headless browser.
