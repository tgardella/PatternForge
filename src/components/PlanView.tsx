"use client";

import { useApp, pxToMmScale } from "@/store";
import { estimateGlass, fmtArea } from "@/lib/estimate";
import { unitToMm } from "@/lib/types";
import type { Face, Pt } from "@/lib/types";

function facePathD(f: Face): string {
  const loop = (pts: Pt[]) =>
    `M ${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L ")} Z`;
  return [loop(f.outer.pts), ...f.holes.map((h) => loop(h.pts))].join(" ");
}

const inputCls =
  "w-24 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800";

export default function PlanView() {
  const graph = useApp((s) => s.graph);
  const faces = useApp((s) => s.faces);
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const version = useApp((s) => s.version);
  void version;

  if (!graph) return null;
  const pxToMm = pxToMmScale(settings, graph);
  const est = estimateGlass(graph, faces, settings, pxToMm);
  const u = settings.units;
  const wReal = settings.widthValue, hReal = settings.heightValue;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start gap-6">
        {/* thumbnail */}
        <svg
          viewBox={`0 0 ${graph.width} ${graph.height}`}
          className="w-56 shrink-0 rounded-lg border border-neutral-300 bg-[#f7f3ea] shadow dark:border-neutral-700"
        >
          {faces.map((f) => {
            const r = graph.regions.get(f.regionId);
            return (
              <path
                key={f.regionId}
                d={facePathD(f)}
                fill={r ? graph.palette[r.colorIdx]?.hex ?? "#999" : "#999"}
                fillRule="evenodd"
                stroke="#27272b"
                strokeWidth={graph.width / 300}
              />
            );
          })}
        </svg>

        <div className="flex min-w-60 flex-1 flex-col gap-2">
          <h2 className="text-lg font-bold">Project plan</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-neutral-500">Finished size</dt>
            <dd>
              {wReal} × {hReal} {u}
            </dd>
            <dt className="text-neutral-500">Pieces</dt>
            <dd>{faces.length}</dd>
            <dt className="text-neutral-500">Colors</dt>
            <dd>{est.colors.length}</dd>
            <dt className="text-neutral-500">Assembly</dt>
            <dd>
              {settings.assembly === "lead"
                ? `Lead came, ${settings.cameWidthIn.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}"`
                : "Copper foil"}
            </dd>
            <dt className="text-neutral-500">Glass to buy</dt>
            <dd className="font-semibold">
              {est.totalBuyUnits} {est.unitLabel}
              {est.totalPrice != null && ` · ≈ $${est.totalPrice.toFixed(2)}`}
            </dd>
          </dl>

          {/* purchase config */}
          <div className="mt-2 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-700">
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              Purchase unit
              <select
                className={inputCls}
                value={settings.purchaseUnit}
                onChange={(e) =>
                  setSettings({ purchaseUnit: e.target.value as "sqft" | "sqm" })
                }
              >
                <option value="sqft">sq ft</option>
                <option value="sqm">m²</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              Min purchase ({est.unitLabel})
              <input
                type="number" min={0} step={1} className={inputCls}
                value={settings.minPurchase}
                onChange={(e) => setSettings({ minPurchase: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              Sheet size ({settings.purchaseUnit === "sqft" ? "in" : "cm"})
              <span className="flex items-center gap-1">
                <input
                  type="number" min={0} className={inputCls} placeholder="W"
                  value={settings.sheetW ?? ""}
                  onChange={(e) =>
                    setSettings({ sheetW: e.target.value ? Number(e.target.value) : undefined })
                  }
                />
                ×
                <input
                  type="number" min={0} className={inputCls} placeholder="H"
                  value={settings.sheetH ?? ""}
                  onChange={(e) =>
                    setSettings({ sheetH: e.target.value ? Number(e.target.value) : undefined })
                  }
                />
              </span>
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              $ / {est.unitLabel} (global)
              <input
                type="number" min={0} step={0.5} className={inputCls}
                value={settings.globalPricePerUnit ?? ""}
                placeholder="—"
                onChange={(e) =>
                  setSettings({
                    globalPricePerUnit: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              />
            </label>
          </div>
        </div>
      </div>

      {/* per-color table */}
      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900">
              <th className="px-3 py-2">Color</th>
              <th className="px-3 py-2">Pieces</th>
              <th className="px-3 py-2">Finished area</th>
              <th className="px-3 py-2">Waste</th>
              <th className="px-3 py-2">Buy</th>
              {est.colors.some((c) => c.sheets != null) && <th className="px-3 py-2">Sheets</th>}
              {est.colors.some((c) => c.price != null) && <th className="px-3 py-2">Cost</th>}
            </tr>
          </thead>
          <tbody>
            {est.colors.map((c) => (
              <tr key={c.colorIdx} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span
                      className="h-5 w-8 rounded border border-neutral-400/50"
                      style={{ background: c.hex }}
                    />
                    <span className="font-mono text-xs">{c.hex}</span>
                    {c.directional && (
                      <span className="rounded bg-purple-500/15 px-1 text-[10px] font-semibold text-purple-600 dark:text-purple-400">
                        directional
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums">{c.pieceCount}</td>
                <td className="px-3 py-2 tabular-nums">
                  {fmtArea(c.netAreaMm2, settings.purchaseUnit)}
                </td>
                <td className="px-3 py-2 tabular-nums" title="breakage + nesting + directional">
                  {Math.round(c.waste * 100)}%
                  <span className="ml-1 text-[10px] text-neutral-500">
                    ({Math.round(c.breakage * 100)}b + {Math.round(c.nesting * 100)}n
                    {c.directionalWaste > 0 && ` + ${Math.round(c.directionalWaste * 100)}d`})
                  </span>
                </td>
                <td className="px-3 py-2 font-semibold tabular-nums">
                  {c.buyUnits} {est.unitLabel}
                </td>
                {est.colors.some((x) => x.sheets != null) && (
                  <td className="px-3 py-2 tabular-nums">{c.sheets ?? "—"}</td>
                )}
                {est.colors.some((x) => x.price != null) && (
                  <td className="px-3 py-2 tabular-nums">
                    {c.price != null ? `$${c.price.toFixed(2)}` : "—"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-neutral-50 font-semibold dark:bg-neutral-900">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 tabular-nums">{faces.length}</td>
              <td className="px-3 py-2 tabular-nums">
                {fmtArea(est.totalNetMm2, settings.purchaseUnit)}
              </td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 tabular-nums">
                {est.totalBuyUnits} {est.unitLabel}
              </td>
              {est.colors.some((x) => x.sheets != null) && <td className="px-3 py-2" />}
              {est.colors.some((x) => x.price != null) && (
                <td className="px-3 py-2 tabular-nums">
                  {est.totalPrice != null ? `$${est.totalPrice.toFixed(2)}` : "—"}
                </td>
              )}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
        <strong>Buy each color in a single purchase</strong> — glass varies by production lot
        and colors are often discontinued. Round up; running short means a visible color
        mismatch. Waste is broken out (b = breakage by skill, n = nesting from piece shapes,
        d = directional grain) so you can tune it.
      </p>

      <p className="text-xs text-neutral-500">
        Nesting waste comes from each color&apos;s packing efficiency (piece area ÷ its minimum
        bounding rectangle): {est.colors.map((c) => `${c.hex} ${(c.packEff * 100).toFixed(0)}%`).join(" · ")}.
        Scale: 1 graph px = {(pxToMm / unitToMm(settings.units)).toFixed(3)} {settings.units}.
      </p>
    </div>
  );
}
