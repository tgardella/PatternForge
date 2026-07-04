// Downscale + light denoise. Pure TypeScript on typed arrays — deterministic,
// no WASM download. (Same classical ops OpenCV would do: resize + medianBlur.)

export interface RGBImage {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA
}

export const MAX_DIM = 1000;

/** Center-crop to the finished panel's aspect ratio so shapes are not
 * distorted when the pattern is scaled to real-world dimensions. */
export function cropToAspect(src: RGBImage, aspect: number): RGBImage {
  const cur = src.width / src.height;
  if (Math.abs(cur - aspect) < 1e-3) return src;
  let w = src.width, h = src.height, x0 = 0, y0 = 0;
  if (cur > aspect) {
    w = Math.max(1, Math.round(src.height * aspect));
    x0 = Math.floor((src.width - w) / 2);
  } else {
    h = Math.max(1, Math.round(src.width / aspect));
    y0 = Math.floor((src.height - h) / 2);
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const srcOff = ((y + y0) * src.width + x0) * 4;
    out.set(src.data.subarray(srcOff, srcOff + w * 4), y * w * 4);
  }
  return { width: w, height: h, data: out };
}

/** Downscale an ImageData-like to fit MAX_DIM, preserving aspect ratio.
 * Box-filter average — good quality for downscale, fully deterministic. */
export function downscale(src: RGBImage, maxDim = MAX_DIM): RGBImage {
  const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
  if (scale >= 1) return src;
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = src.width / w, sy = src.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.min(src.height, Math.ceil((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.min(src.width, Math.ceil((x + 1) * sx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let idx = (yy * src.width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, idx += 4) {
          r += src.data[idx]; g += src.data[idx + 1]; b += src.data[idx + 2];
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

/** 3x3 median filter per channel — removes speckle noise before clustering. */
export function medianDenoise(img: RGBImage): RGBImage {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(data.length);
  const win = new Uint8ClampedArray(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            win[n++] = data[(yy * w + xx) * 4 + c];
          }
        }
        // median of 9 via partial sort
        const arr = Array.from(win.subarray(0, n)).sort((a, b) => a - b);
        out[o + c] = arr[4];
      }
      out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}
