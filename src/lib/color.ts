// sRGB <-> CIELAB conversion (D65), used for perceptual k-means clustering.

export function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  // sRGB -> linear
  const lin = (c: number) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const R = lin(r), G = lin(g), B = lin(b);
  // linear RGB -> XYZ (D65)
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
  // XYZ -> Lab
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X / 0.95047), fy = f(Y), fz = f(Z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToSrgb(L: number, a: number, bb: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - bb / 200;
  const finv = (t: number) => {
    const t3 = t * t * t;
    return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
  };
  const X = finv(fx) * 0.95047, Y = finv(fy), Z = finv(fz) * 1.08883;
  let R = X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314;
  let G = X * -0.969266 + Y * 1.8760108 + Z * 0.041556;
  let B = X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252;
  const enc = (c: number) => {
    c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
  };
  return [enc(R), enc(G), enc(B)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => v.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Squared distance in Lab space. */
export function labDist2(
  a: [number, number, number] | Float32Array,
  b: [number, number, number] | Float32Array,
  ai = 0,
  bi = 0
): number {
  const dl = a[ai] - b[bi];
  const da = a[ai + 1] - b[bi + 1];
  const db = a[ai + 2] - b[bi + 2];
  return dl * dl + da * da + db * db;
}
