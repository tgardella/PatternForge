// Built-in sample reference image (drawn on a canvas — no network, no files):
// a stylized sunrise landscape with hills, water and a sun. Gives k-means
// distinct color families and produces a pleasant first pattern.

import type { RGBImage } from "./pipeline/preprocess";

export function makeSampleImage(w = 900, h = 1200): RGBImage {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.55);
  sky.addColorStop(0, "#2c3e6b");
  sky.addColorStop(0.5, "#7a5c8f");
  sky.addColorStop(1, "#e8955c");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.58);

  // sun + halo
  ctx.fillStyle = "#f6d365";
  ctx.beginPath();
  ctx.arc(w * 0.62, h * 0.4, w * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f0a848";
  ctx.beginPath();
  ctx.arc(w * 0.62, h * 0.4, w * 0.19, 0, Math.PI * 2);
  ctx.globalAlpha = 0.45;
  ctx.fill();
  ctx.globalAlpha = 1;

  // far hills
  ctx.fillStyle = "#4a6741";
  ctx.beginPath();
  ctx.moveTo(0, h * 0.5);
  ctx.quadraticCurveTo(w * 0.25, h * 0.4, w * 0.5, h * 0.49);
  ctx.quadraticCurveTo(w * 0.7, h * 0.55, w, h * 0.47);
  ctx.lineTo(w, h * 0.62);
  ctx.lineTo(0, h * 0.62);
  ctx.closePath();
  ctx.fill();

  // near hills
  ctx.fillStyle = "#2f4a2c";
  ctx.beginPath();
  ctx.moveTo(0, h * 0.58);
  ctx.quadraticCurveTo(w * 0.35, h * 0.5, w * 0.62, h * 0.6);
  ctx.quadraticCurveTo(w * 0.82, h * 0.67, w, h * 0.6);
  ctx.lineTo(w, h * 0.72);
  ctx.lineTo(0, h * 0.72);
  ctx.closePath();
  ctx.fill();

  // water
  const water = ctx.createLinearGradient(0, h * 0.66, 0, h);
  water.addColorStop(0, "#3f6f8f");
  water.addColorStop(1, "#1d3a55");
  ctx.fillStyle = water;
  ctx.fillRect(0, h * 0.66, w, h * 0.34);

  // sun reflection on water
  ctx.fillStyle = "#e8b45c";
  for (let i = 0; i < 7; i++) {
    const y = h * (0.7 + i * 0.038);
    const ww = w * (0.16 - i * 0.016);
    ctx.beginPath();
    ctx.ellipse(w * 0.62, y, ww, h * 0.011, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // foreground tree silhouette
  ctx.fillStyle = "#1c2416";
  ctx.beginPath();
  ctx.moveTo(w * 0.1, h * 0.72);
  ctx.bezierCurveTo(w * 0.08, h * 0.5, w * 0.13, h * 0.42, w * 0.14, h * 0.3);
  ctx.bezierCurveTo(w * 0.16, h * 0.42, w * 0.2, h * 0.48, w * 0.19, h * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(w * 0.145, h * 0.3, w * 0.1, 0, Math.PI * 2);
  ctx.arc(w * 0.09, h * 0.4, w * 0.075, 0, Math.PI * 2);
  ctx.arc(w * 0.2, h * 0.42, w * 0.08, 0, Math.PI * 2);
  ctx.fill();

  // birds
  ctx.strokeStyle = "#1c2416";
  ctx.lineWidth = w * 0.006;
  ctx.lineCap = "round";
  for (const [bx, by, s] of [
    [0.4, 0.22, 1], [0.48, 0.18, 0.8], [0.34, 0.16, 0.65],
  ] as const) {
    ctx.beginPath();
    ctx.arc(w * bx - w * 0.02 * s, h * by, w * 0.02 * s, Math.PI * 1.1, Math.PI * 1.9);
    ctx.arc(w * bx + w * 0.02 * s, h * by, w * 0.02 * s, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }

  const data = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data: data.data };
}
