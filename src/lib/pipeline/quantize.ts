// K-means color quantization in CIELAB with deterministic k-means++ seeding.
// Final palette color per cluster = per-channel MEDIAN of member pixels (RGB).

import { srgbToLab, rgbToHex } from "../color";
import { mulberry32 } from "../geometry";
import type { RGBImage } from "./preprocess";
import type { PaletteColor } from "../types";

export interface QuantizeResult {
  /** cluster index per pixel */
  labels: Int32Array;
  palette: PaletteColor[];
}

export function quantize(img: RGBImage, k: number): QuantizeResult {
  const n = img.width * img.height;
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [L, a, b] = srgbToLab(
      img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]
    );
    lab[i * 3] = L; lab[i * 3 + 1] = a; lab[i * 3 + 2] = b;
  }

  // ---- k-means++ init (deterministic seed) on a subsample for speed ----
  const rand = mulberry32(0xf0f0f0);
  const sampleN = Math.min(n, 20000);
  const sampleIdx = new Int32Array(sampleN);
  for (let i = 0; i < sampleN; i++) sampleIdx[i] = Math.floor(rand() * n);

  const centers = new Float32Array(k * 3);
  const d2 = new Float32Array(sampleN).fill(Infinity);
  {
    const first = sampleIdx[Math.floor(rand() * sampleN)];
    centers[0] = lab[first * 3]; centers[1] = lab[first * 3 + 1]; centers[2] = lab[first * 3 + 2];
    for (let c = 1; c < k; c++) {
      let sum = 0;
      for (let i = 0; i < sampleN; i++) {
        const p = sampleIdx[i] * 3;
        const dl = lab[p] - centers[(c - 1) * 3];
        const da = lab[p + 1] - centers[(c - 1) * 3 + 1];
        const db = lab[p + 2] - centers[(c - 1) * 3 + 2];
        const d = dl * dl + da * da + db * db;
        if (d < d2[i]) d2[i] = d;
        sum += d2[i];
      }
      let r = rand() * sum;
      let pick = sampleN - 1;
      for (let i = 0; i < sampleN; i++) {
        r -= d2[i];
        if (r <= 0) { pick = i; break; }
      }
      const p = sampleIdx[pick] * 3;
      centers[c * 3] = lab[p]; centers[c * 3 + 1] = lab[p + 1]; centers[c * 3 + 2] = lab[p + 2];
    }
  }

  // ---- Lloyd iterations on all pixels ----
  const labels = new Int32Array(n);
  const sums = new Float64Array(k * 3);
  const counts = new Int32Array(k);
  for (let iter = 0; iter < 12; iter++) {
    sums.fill(0); counts.fill(0);
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const p = i * 3;
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dl = lab[p] - centers[c * 3];
        const da = lab[p + 1] - centers[c * 3 + 1];
        const db = lab[p + 2] - centers[c * 3 + 2];
        const d = dl * dl + da * da + db * db;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (labels[i] !== best) { labels[i] = best; changed++; }
      sums[best * 3] += lab[p];
      sums[best * 3 + 1] += lab[p + 1];
      sums[best * 3 + 2] += lab[p + 2];
      counts[best]++;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        centers[c * 3] = sums[c * 3] / counts[c];
        centers[c * 3 + 1] = sums[c * 3 + 1] / counts[c];
        centers[c * 3 + 2] = sums[c * 3 + 2] / counts[c];
      }
    }
    if (changed === 0 && iter > 0) break;
  }

  // ---- palette = per-channel MEDIAN RGB of each cluster's pixels ----
  const palette: PaletteColor[] = [];
  for (let c = 0; c < k; c++) {
    const rs: number[] = [], gs: number[] = [], bs: number[] = [];
    // subsample members for the median (cap for speed)
    const stride = Math.max(1, Math.floor(counts[c] / 30000));
    let seen = 0;
    for (let i = 0; i < n; i++) {
      if (labels[i] !== c) continue;
      if (seen++ % stride !== 0) continue;
      rs.push(img.data[i * 4]); gs.push(img.data[i * 4 + 1]); bs.push(img.data[i * 4 + 2]);
    }
    const med = (arr: number[]) => {
      if (arr.length === 0) return 128;
      arr.sort((a, b) => a - b);
      return arr[Math.floor(arr.length / 2)];
    };
    const rgb: [number, number, number] = [med(rs), med(gs), med(bs)];
    palette.push({ rgb, hex: rgbToHex(...rgb), directional: false });
  }
  return { labels, palette };
}
