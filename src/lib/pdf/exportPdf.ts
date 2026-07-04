// Multi-page, to-scale PDF export.
//
// ALL pattern geometry is laid out in true millimetres and converted to PDF
// points (1 mm = 72/25.4 pt) — never scaled to fit the page. Page 1 carries a
// 25.4 mm calibration square so the user can verify "Actual Size" printing.
//
// Structure: [plan page] [legend page(s)] [tiled pattern pages A1, A2, ... ]

import {
  PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, LineCapStyle,
  pushGraphicsState, popGraphicsState, moveTo, lineTo, closePath, clip, endPath,
} from "pdf-lib";
import type { Face, PatternGraph, Pt, Settings } from "../types";
import { estimateGlass, fmtArea } from "../estimate";

const MM2PT = 72 / 25.4;
const mm = (v: number) => v * MM2PT;

const PAGE_SIZES_MM = {
  letter: { w: 215.9, h: 279.4 },
  a4: { w: 210, h: 297 },
};

const MARGIN_MM = 12;
const OVERLAP_MM = 15;

export interface ExportInput {
  graph: PatternGraph;
  faces: Face[];
  settings: Settings;
  pxToMm: number;
}

interface Piece {
  number: number;
  colorIdx: number;
  hex: string;
  /** outline in physical mm (thumbnail + label sizing) */
  raw: Pt[];
  labelMm: Pt;
  areaMm2: number;
}

function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0.5, 0.5, 0.5];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export async function buildPatternPdf(input: ExportInput): Promise<Uint8Array> {
  const { graph, faces, settings, pxToMm } = input;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const page = PAGE_SIZES_MM[settings.pageSize];
  const printW = page.w - 2 * MARGIN_MM;
  const printH = page.h - 2 * MARGIN_MM;
  const stepX = printW - OVERLAP_MM;
  const stepY = printH - OVERLAP_MM;

  const panelW = graph.width * pxToMm;
  const panelH = graph.height * pxToMm;

  const cols = Math.max(1, Math.ceil((panelW - printW) / stepX + 1e-9) + 1);
  const rows = Math.max(1, Math.ceil((panelH - printH) / stepY + 1e-9) + 1);

  // ---- pieces in physical mm --------------------------------------------
  const pieces: Piece[] = faces.map((f, i) => {
    const raw = f.outer.pts.map((p) => ({ x: p.x * pxToMm, y: p.y * pxToMm }));
    const region = graph.regions.get(f.regionId);
    const colorIdx = region?.colorIdx ?? 0;
    return {
      number: i + 1,
      colorIdx,
      hex: graph.palette[colorIdx]?.hex ?? "#888888",
      raw,
      labelMm: { x: f.labelPos.x * pxToMm, y: f.labelPos.y * pxToMm },
      areaMm2: f.area * pxToMm * pxToMm,
    };
  });

  // Lead/foil lines: each shared arc is drawn ONCE as a solid black stroke.
  // For lead the stroke is the full came width, so the white area left on
  // each side is the piece trimmed by half the came width — the stroke edge
  // IS the cut line. For foil a thin line marks the shared cut.
  const lineWidthMm =
    settings.assembly === "lead" ? settings.cameWidthIn * 25.4 : 1.2;
  const arcsMm = [...graph.arcs.values()].map((a) =>
    a.pts.map((p) => ({ x: p.x * pxToMm, y: p.y * pxToMm }))
  );

  const est = estimateGlass(graph, faces, settings, pxToMm);

  // ======================= PAGE 1: PLAN =================================
  {
    const p = doc.addPage([mm(page.w), mm(page.h)]);
    const top = (y: number) => mm(page.h - y); // y in mm from top

    p.drawText("PatternForge — Project Plan", {
      x: mm(MARGIN_MM), y: top(MARGIN_MM + 6), size: 16, font: bold,
    });
    const sub = `${settings.widthValue} × ${settings.heightValue} ${settings.units}  ·  ${faces.length} pieces  ·  ${est.colors.length} colors  ·  ${
      settings.assembly === "lead" ? `lead came ${fractionLabel(settings.cameWidthIn)}` : "copper foil"
    }`;
    p.drawText(sub, {
      x: mm(MARGIN_MM), y: top(MARGIN_MM + 12), size: 10, font,
      color: rgb(0.35, 0.35, 0.35),
    });

    // thumbnail (NOT to scale)
    const thumbBox = { x: MARGIN_MM, y: MARGIN_MM + 18, w: 80, h: 105 };
    const s = Math.min(thumbBox.w / panelW, thumbBox.h / panelH);
    for (const piece of pieces) {
      const d = svgPathD(piece.raw.map((q) => ({ x: q.x * s, y: q.y * s })));
      const [r, g, b] = hexToRgb01(piece.hex);
      p.drawSvgPath(d, {
        x: mm(thumbBox.x),
        y: top(thumbBox.y),
        scale: MM2PT,
        color: rgb(r, g, b),
        borderColor: rgb(0.15, 0.15, 0.17),
        borderWidth: 0.7,
      });
    }
    p.drawText("Preview (not to scale)", {
      x: mm(thumbBox.x), y: top(thumbBox.y + panelH * s + 5), size: 8, font,
      color: rgb(0.4, 0.4, 0.4),
    });

    // calibration square
    const cal = { x: page.w - MARGIN_MM - 25.4, y: MARGIN_MM + 18 };
    p.drawRectangle({
      x: mm(cal.x), y: top(cal.y + 25.4), width: mm(25.4), height: mm(25.4),
      borderColor: rgb(0, 0, 0), borderWidth: 1.2,
    });
    p.drawText("CALIBRATION", {
      x: mm(cal.x + 1.5), y: top(cal.y + 11), size: 7, font: bold,
    });
    p.drawText('1 inch / 25.4 mm', {
      x: mm(cal.x + 1.5), y: top(cal.y + 14.5), size: 7, font,
    });
    wrapText(
      p, font, 7,
      "Print at 100% / Actual Size — this box must measure exactly 1 inch (25.4 mm) or reprint. Never use 'Fit to page'.",
      { x: cal.x - 40, yTop: cal.y + 30, width: 68, leading: 3.4 }, rgb(0.7, 0.1, 0.1)
    );

    // glass-per-color table
    let ty = thumbBox.y + 118;
    p.drawText("Glass to buy (per color)", {
      x: mm(MARGIN_MM), y: top(ty), size: 11, font: bold,
    });
    ty += 6;
    const cX = [MARGIN_MM, MARGIN_MM + 14, MARGIN_MM + 40, MARGIN_MM + 58, MARGIN_MM + 88, MARGIN_MM + 128, MARGIN_MM + 158];
    const header = ["", "hex", "pieces", "finished area", "waste (b+n+d)", `buy (${est.unitLabel})`, "cost"];
    header.forEach((hdr, i) =>
      p.drawText(hdr, { x: mm(cX[i]), y: top(ty), size: 7.5, font: bold, color: rgb(0.3, 0.3, 0.3) })
    );
    ty += 5.5;
    for (const c of est.colors) {
      const [r, g, b] = hexToRgb01(c.hex);
      p.drawRectangle({
        x: mm(cX[0]), y: top(ty + 1), width: mm(10), height: mm(4.5),
        color: rgb(r, g, b), borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 0.5,
      });
      const cells = [
        "",
        c.hex + (c.directional ? " (dir.)" : ""),
        String(c.pieceCount),
        fmtArea(c.netAreaMm2, settings.purchaseUnit),
        `${Math.round(c.waste * 100)}%  (${Math.round(c.breakage * 100)}+${Math.round(c.nesting * 100)}+${Math.round(c.directionalWaste * 100)})`,
        `${c.buyUnits}${c.sheets != null ? `  (~${c.sheets} sheet${c.sheets === 1 ? "" : "s"})` : ""}`,
        c.price != null ? `$${c.price.toFixed(2)}` : "—",
      ];
      cells.forEach((cell, i) => {
        if (i === 0) return;
        p.drawText(cell, { x: mm(cX[i]), y: top(ty + 0.5), size: 8, font });
      });
      ty += 6.5;
    }
    ty += 1;
    p.drawText(
      `Total: ${fmtArea(est.totalNetMm2, settings.purchaseUnit)} finished -> buy ${est.totalBuyUnits} ${est.unitLabel}` +
        (est.totalPrice != null ? `  ·  ~ $${est.totalPrice.toFixed(2)}` : ""),
      { x: mm(MARGIN_MM), y: top(ty + 2), size: 9, font: bold }
    );
    ty += 10;
    wrapText(
      p, font, 8,
      "Buy each color in a single purchase — glass varies by production lot and colors are often discontinued. Round up; running short means a visible color mismatch. Waste = breakage (skill) + nesting (piece shapes) + directional grain.",
      { x: MARGIN_MM, yTop: ty, width: page.w - 2 * MARGIN_MM, leading: 4 },
      rgb(0.45, 0.3, 0.05)
    );
    ty += 14;

    // assembly map
    p.drawText(`Pattern pages: ${cols} × ${rows} = ${cols * rows} sheets (${settings.pageSize.toUpperCase()}), ${OVERLAP_MM} mm overlap`, {
      x: mm(MARGIN_MM), y: top(ty + 2), size: 9, font: bold,
    });
    ty += 6;
    const cell = Math.min(18, (page.w - 2 * MARGIN_MM) / cols, 60 / rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        p.drawRectangle({
          x: mm(MARGIN_MM + c * cell), y: top(ty + (r + 1) * cell),
          width: mm(cell), height: mm(cell),
          borderColor: rgb(0.55, 0.55, 0.55), borderWidth: 0.6,
        });
        const label = pageLabel(r, c);
        p.drawText(label, {
          x: mm(MARGIN_MM + c * cell + cell / 2) - bold.widthOfTextAtSize(label, 7) / 2,
          y: top(ty + r * cell + cell / 2 + 1.5),
          size: 7, font: bold, color: rgb(0.3, 0.3, 0.3),
        });
      }
    }
  }

  // ======================= LEGEND PAGE(S) ================================
  {
    let p = doc.addPage([mm(page.w), mm(page.h)]);
    let y = MARGIN_MM + 8;
    const top = (yy: number) => mm(page.h - yy);
    p.drawText("Legend — piece numbers by glass color", {
      x: mm(MARGIN_MM), y: top(y), size: 13, font: bold,
    });
    y += 9;
    const byColor = new Map<number, number[]>();
    for (const piece of pieces) {
      const l = byColor.get(piece.colorIdx) ?? [];
      l.push(piece.number);
      byColor.set(piece.colorIdx, l);
    }
    for (const [colorIdx, nums] of [...byColor.entries()].sort((a, b) => a[0] - b[0])) {
      const hex = graph.palette[colorIdx]?.hex ?? "#888888";
      const [r, g, b] = hexToRgb01(hex);
      if (y > page.h - MARGIN_MM - 15) {
        p = doc.addPage([mm(page.w), mm(page.h)]);
        y = MARGIN_MM + 8;
      }
      p.drawRectangle({
        x: mm(MARGIN_MM), y: top(y + 4.5), width: mm(14), height: mm(6),
        color: rgb(r, g, b), borderColor: rgb(0.3, 0.3, 0.3), borderWidth: 0.6,
      });
      p.drawText(`${hex}  ·  ${nums.length} piece${nums.length === 1 ? "" : "s"}${graph.palette[colorIdx]?.directional ? "  ·  directional/streaky" : ""}`, {
        x: mm(MARGIN_MM + 17), y: top(y + 3.5), size: 9, font: bold,
      });
      y += 8;
      const numsStr = nums.join(", ");
      const lines = breakIntoLines(numsStr, font, 8, page.w - 2 * MARGIN_MM - 5);
      for (const line of lines) {
        if (y > page.h - MARGIN_MM - 8) {
          p = doc.addPage([mm(page.w), mm(page.h)]);
          y = MARGIN_MM + 8;
        }
        p.drawText(line, {
          x: mm(MARGIN_MM + 5), y: top(y + 2.5), size: 8, font,
          color: rgb(0.25, 0.25, 0.25),
        });
        y += 4.2;
      }
      y += 4;
    }
  }

  // ======================= PATTERN PAGES =================================
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const p = doc.addPage([mm(page.w), mm(page.h)]);
      const tileX = col * stepX; // physical mm of tile's left edge
      const tileY = row * stepY;
      const label = pageLabel(row, col);

      // physical mm -> page pt
      const X = (xMm: number) => mm(xMm - tileX + MARGIN_MM);
      const Y = (yMm: number) => mm(page.h - (yMm - tileY + MARGIN_MM));

      // header (outside printable area, in the margin)
      p.drawText(`PatternForge  ·  page ${label}  ·  print at 100% (Actual Size)`, {
        x: mm(MARGIN_MM), y: mm(page.h - MARGIN_MM + 3), size: 8, font: bold,
        color: rgb(0.3, 0.3, 0.3),
      });
      const neighbors: string[] = [];
      if (col < cols - 1) neighbors.push(`${pageLabel(row, col + 1)} overlaps right`);
      if (row < rows - 1) neighbors.push(`${pageLabel(row + 1, col)} overlaps below`);
      if (neighbors.length) {
        const t = neighbors.join("  ·  ");
        p.drawText(t, {
          x: mm(page.w - MARGIN_MM) - font.widthOfTextAtSize(t, 7), y: mm(page.h - MARGIN_MM + 3),
          size: 7, font, color: rgb(0.45, 0.45, 0.45),
        });
      }

      // corner registration marks (printable-area corners)
      drawCornerMarks(p, page, rgb(0.2, 0.2, 0.2));

      // clip to printable area
      p.pushOperators(
        pushGraphicsState(),
        moveTo(mm(MARGIN_MM), mm(MARGIN_MM)),
        lineTo(mm(page.w - MARGIN_MM), mm(MARGIN_MM)),
        lineTo(mm(page.w - MARGIN_MM), mm(page.h - MARGIN_MM)),
        lineTo(mm(MARGIN_MM), mm(page.h - MARGIN_MM)),
        closePath(),
        clip(),
        endPath()
      );

      // lead/foil lines: solid black, came-width strokes on the shared arcs
      const halfLine = lineWidthMm / 2;
      for (const arcPts of arcsMm) {
        if (ringOutsideTile(arcPts, tileX - halfLine, tileY - halfLine, printW + lineWidthMm, printH + lineWidthMm)) continue;
        const d = openPathD(arcPts);
        p.drawSvgPath(d, {
          x: X(0),
          y: mm(page.h) - mm(-tileY + MARGIN_MM),
          scale: MM2PT,
          borderColor: rgb(0, 0, 0),
          borderWidth: mm(lineWidthMm),
          borderLineCap: LineCapStyle.Round,
        });
      }
      for (const piece of pieces) {
        // piece number
        const fontMm = Math.max(2.6, Math.min(8, 0.22 * Math.sqrt(piece.areaMm2)));
        const sizePt = mm(fontMm);
        const lbl = String(piece.number);
        const wPt = bold.widthOfTextAtSize(lbl, sizePt);
        const lx = X(piece.labelMm.x) - wPt / 2;
        const ly = Y(piece.labelMm.y) - sizePt * 0.36;
        if (
          piece.labelMm.x > tileX - 5 && piece.labelMm.x < tileX + printW + 5 &&
          piece.labelMm.y > tileY - 5 && piece.labelMm.y < tileY + printH + 5
        ) {
          p.drawText(lbl, { x: lx, y: ly, size: sizePt, font: bold, color: rgb(0.1, 0.1, 0.1) });
        }
      }

      // seam match lines + crosses (physical positions → appear on BOTH pages)
      const dash = { dashArray: [mm(2.5), mm(1.5)] };
      for (let c = 1; c < cols; c++) {
        const xPhys = c * stepX; // left edge of tile c (inside previous tile)
        const x2 = c * stepX + OVERLAP_MM; // right edge of overlap band
        for (const xs of [xPhys, x2]) {
          if (xs > tileX - 1 && xs < tileX + printW + 1) {
            p.drawLine({
              start: { x: X(xs), y: Y(Math.max(0, tileY)) },
              end: { x: X(xs), y: Y(Math.min(panelH, tileY + printH)) },
              thickness: 0.5, color: rgb(0.55, 0.55, 0.85), ...dash,
            });
          }
        }
        const xm = xPhys + OVERLAP_MM / 2;
        if (xm > tileX && xm < tileX + printW) {
          for (const frac of [0.12, 0.5, 0.88]) {
            const ym = Math.min(panelH, tileY + printH * frac);
            drawCross(p, X(xm), Y(ym), mm(3), rgb(0.2, 0.2, 0.6));
          }
        }
      }
      for (let r = 1; r < rows; r++) {
        const yPhys = r * stepY;
        const y2 = r * stepY + OVERLAP_MM;
        for (const ys of [yPhys, y2]) {
          if (ys > tileY - 1 && ys < tileY + printH + 1) {
            p.drawLine({
              start: { x: X(Math.max(0, tileX)), y: Y(ys) },
              end: { x: X(Math.min(panelW, tileX + printW)), y: Y(ys) },
              thickness: 0.5, color: rgb(0.55, 0.55, 0.85), ...dash,
            });
          }
        }
        const ym = yPhys + OVERLAP_MM / 2;
        if (ym > tileY && ym < tileY + printH) {
          for (const frac of [0.12, 0.5, 0.88]) {
            const xm = Math.min(panelW, tileX + printW * frac);
            drawCross(p, X(xm), Y(ym), mm(3), rgb(0.2, 0.2, 0.6));
          }
        }
      }

      // calibration square on the FIRST pattern page
      if (row === 0 && col === 0) {
        const cx = MARGIN_MM + 2, cy = MARGIN_MM + 2; // page-local mm from top-left
        p.drawRectangle({
          x: mm(cx), y: mm(page.h - cy - 25.4), width: mm(25.4), height: mm(25.4),
          color: rgb(1, 1, 1), borderColor: rgb(0, 0, 0), borderWidth: 1.2,
          opacity: 0.92,
        });
        p.drawText("1 in / 25.4 mm", {
          x: mm(cx + 1.6), y: mm(page.h - cy - 8), size: 7, font: bold,
        });
        p.drawText("Print at 100% /", { x: mm(cx + 1.6), y: mm(page.h - cy - 13), size: 6, font });
        p.drawText("Actual Size. Must", { x: mm(cx + 1.6), y: mm(page.h - cy - 16.5), size: 6, font });
        p.drawText("measure exactly", { x: mm(cx + 1.6), y: mm(page.h - cy - 20), size: 6, font });
        p.drawText("1 inch — or reprint.", { x: mm(cx + 1.6), y: mm(page.h - cy - 23.5), size: 6, font });
      }

      p.pushOperators(popGraphicsState());

      // page grid label bottom margin
      p.drawText(`${label}  (row ${row + 1}/${rows}, col ${col + 1}/${cols})`, {
        x: mm(MARGIN_MM), y: mm(MARGIN_MM - 8), size: 8, font,
        color: rgb(0.4, 0.4, 0.4),
      });
    }
  }

  return doc.save();
}

// ---------------------------------------------------------------------------

function pageLabel(row: number, col: number): string {
  let r = row, letters = "";
  do {
    letters = String.fromCharCode(65 + (r % 26)) + letters;
    r = Math.floor(r / 26) - 1;
  } while (r >= 0);
  return `${letters}${col + 1}`;
}

function fractionLabel(inches: number): string {
  const fracs: [number, string][] = [
    [1 / 8, '1/8"'], [5 / 32, '5/32"'], [3 / 16, '3/16"'], [1 / 4, '1/4"'], [3 / 8, '3/8"'],
  ];
  for (const [v, l] of fracs) if (Math.abs(v - inches) < 1e-6) return l;
  return `${inches.toFixed(3)}"`;
}

function svgPathD(pts: Pt[]): string {
  return (
    `M ${pts.map((p) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(" L ")} Z`
  );
}

function openPathD(pts: Pt[]): string {
  return `M ${pts.map((p) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(" L ")}`;
}

function ringOutsideTile(
  ring: Pt[], tileX: number, tileY: number, w: number, h: number
): boolean {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return maxX < tileX || minX > tileX + w || maxY < tileY || minY > tileY + h;
}

/** L-shaped crop/registration marks at the four printable-area corners. */
function drawCornerMarks(
  p: PDFPage,
  page: { w: number; h: number },
  color: ReturnType<typeof rgb>
) {
  const L = mm(5);
  const corners = [
    { x: mm(MARGIN_MM), y: mm(MARGIN_MM), dx: 1, dy: 1 },
    { x: mm(page.w - MARGIN_MM), y: mm(MARGIN_MM), dx: -1, dy: 1 },
    { x: mm(MARGIN_MM), y: mm(page.h - MARGIN_MM), dx: 1, dy: -1 },
    { x: mm(page.w - MARGIN_MM), y: mm(page.h - MARGIN_MM), dx: -1, dy: -1 },
  ];
  for (const c of corners) {
    p.drawLine({
      start: { x: c.x, y: c.y },
      end: { x: c.x + c.dx * L, y: c.y },
      thickness: 0.6, color,
    });
    p.drawLine({
      start: { x: c.x, y: c.y },
      end: { x: c.x, y: c.y + c.dy * L },
      thickness: 0.6, color,
    });
  }
}

function drawCross(p: PDFPage, x: number, y: number, r: number, color: ReturnType<typeof rgb>) {
  p.drawLine({ start: { x: x - r, y }, end: { x: x + r, y }, thickness: 0.5, color });
  p.drawLine({ start: { x, y: y - r }, end: { x, y: y + r }, thickness: 0.5, color });
  p.drawCircle({ x, y, size: r * 0.55, borderColor: color, borderWidth: 0.5 });
}

function wrapText(
  p: PDFPage, font: PDFFont, size: number, text: string,
  box: { x: number; yTop: number; width: number; leading: number },
  color: ReturnType<typeof rgb>
) {
  const lines = breakIntoLines(text, font, size, box.width);
  let y = box.yTop;
  const pageH = p.getHeight() / MM2PT;
  for (const line of lines) {
    p.drawText(line, { x: mm(box.x), y: mm(pageH - y), size, font, color });
    y += box.leading;
  }
}

function breakIntoLines(text: string, font: PDFFont, size: number, widthMm: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? cur + " " + w : w;
    if (font.widthOfTextAtSize(cand, size) > mm(widthMm) && cur) {
      lines.push(cur);
      cur = w;
    } else cur = cand;
  }
  if (cur) lines.push(cur);
  return lines;
}
