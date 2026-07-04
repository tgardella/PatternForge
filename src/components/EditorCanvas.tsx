"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/store";
import { pxToMmScale } from "@/store";
import type { Arc, Face, Pt } from "@/lib/types";
import {
  addLine, deleteArc, insertArcPoint, moveArcPoint, moveNode, type ArcHit,
} from "@/lib/graph";

function facePathD(face: Face): string {
  const loop = (pts: Pt[]) =>
    pts.length
      ? `M ${pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" L ")} Z`
      : "";
  return [loop(face.outer.pts), ...face.holes.map((h) => loop(h.pts))].join(" ");
}

function arcPathD(arc: Arc): string {
  return `M ${arc.pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" L ")}`;
}

function nearestOnArc(arc: Arc, p: Pt): ArcHit {
  let best: ArcHit = { arcId: arc.id, segIdx: 0, t: 0, p: { ...arc.pts[0] } };
  let bestD = Infinity;
  for (let i = 0; i < arc.pts.length - 1; i++) {
    const a = arc.pts[i], b = arc.pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    let t = l2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bestD) {
      bestD = d;
      best = { arcId: arc.id, segIdx: i, t, p: q };
    }
  }
  return best;
}

type DragState =
  | { kind: "node"; nodeId: number }
  | { kind: "arcpt"; arcId: number; idx: number }
  | { kind: "pan"; startX: number; startY: number; tx0: number; ty0: number }
  | null;

interface DeleteChoice {
  arcId: number;
  screen: { x: number; y: number };
  leftHex: string;
  rightHex: string;
}

export default function EditorCanvas() {
  const graph = useApp((s) => s.graph);
  const faces = useApp((s) => s.faces);
  const warnings = useApp((s) => s.warnings);
  const version = useApp((s) => s.version);
  const tool = useApp((s) => s.tool);
  const settings = useApp((s) => s.settings);
  const selectedRegion = useApp((s) => s.selectedRegion);
  const select = useApp((s) => s.select);
  const applyEdit = useApp((s) => s.applyEdit);
  const applyGeometry = useApp((s) => s.applyGeometry);
  const beginDrag = useApp((s) => s.beginDrag);
  const finishDrag = useApp((s) => s.finishDrag);

  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [viewT, setViewT] = useState({ k: 1, tx: 0, ty: 0 });
  const dragRef = useRef<DragState>(null);
  const draggedRef = useRef(false);
  const [anchor, setAnchor] = useState<ArcHit | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [hoverArc, setHoverArc] = useState<number | null>(null);
  const [deleteChoice, setDeleteChoice] = useState<DeleteChoice | null>(null);
  const [drawError, setDrawError] = useState<string | null>(null);

  // reset transient state when the tool or the graph changes
  useEffect(() => {
    setAnchor(null);
    setDeleteChoice(null);
    setDrawError(null);
  }, [tool, graph]);

  const fitView = useCallback(() => {
    const wrap = wrapRef.current;
    const g = useApp.getState().graph;
    if (!wrap || !g) return;
    const { clientWidth: cw, clientHeight: ch } = wrap;
    const k = Math.min(cw / g.width, ch / g.height) * 0.92;
    setViewT({
      k,
      tx: (cw - g.width * k) / 2,
      ty: (ch - g.height * k) / 2,
    });
  }, []);

  // fit whenever a new pattern arrives
  useEffect(() => {
    fitView();
  }, [graph, fitView]);

  const toWorld = useCallback((clientX: number, clientY: number): Pt => {
    const g = gRef.current!;
    const ctm = g.getScreenCTM()!;
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }, []);

  if (!graph) return null;
  void version; // subscribe: re-render on every graph mutation

  const pxToMm = pxToMmScale(settings, graph);
  const leadWidthPx =
    settings.assembly === "lead"
      ? (settings.cameWidthIn * 25.4) / pxToMm
      : 1.8 / pxToMm;
  const lineColor = settings.assembly === "lead" ? "#27272b" : "#5f4433";
  const hitWidthPx = Math.max(leadWidthPx * 2.5, 8 / viewT.k);

  const arcs = [...graph.arcs.values()];
  const warnByRegion = new Map<number, string[]>();
  for (const w of warnings) {
    const l = warnByRegion.get(w.regionId) ?? [];
    l.push(w.message);
    warnByRegion.set(w.regionId, l);
  }
  const faceByRegion = new Map(faces.map((f) => [f.regionId, f]));

  // ---- pointer handlers -----------------------------------------------

  const onWheel = (e: React.WheelEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    setViewT((v) => {
      const k = Math.min(40, Math.max(0.2, v.k * factor));
      const scale = k / v.k;
      return { k, tx: mx - (mx - v.tx) * scale, ty: my - (my - v.ty) * scale };
    });
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = {
      kind: "pan",
      startX: e.clientX,
      startY: e.clientY,
      tx0: viewT.tx,
      ty0: viewT.ty,
    };
    draggedRef.current = false;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (tool === "draw" && anchor) setCursor(toWorld(e.clientX, e.clientY));
    if (!d) return;
    draggedRef.current = true;
    if (d.kind === "pan") {
      setViewT((v) => ({
        ...v,
        tx: d.tx0 + (e.clientX - d.startX),
        ty: d.ty0 + (e.clientY - d.startY),
      }));
      return;
    }
    const p = toWorld(e.clientX, e.clientY);
    // clamp to panel bounds
    p.x = Math.max(0, Math.min(graph.width, p.x));
    p.y = Math.max(0, Math.min(graph.height, p.y));
    if (d.kind === "node") applyGeometry((g) => moveNode(g, d.nodeId, p));
    else if (d.kind === "arcpt")
      applyGeometry((g) => moveArcPoint(g, d.arcId, d.idx, p));
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && d.kind !== "pan" && draggedRef.current) finishDrag();
  };

  const onFaceClick = (face: Face) => {
    if (tool === "select") {
      select(face.regionId);
      setDeleteChoice(null);
    }
  };

  const onArcPointerDown = (arc: Arc, e: React.PointerEvent) => {
    if (tool === "select") {
      // grab the line: insert a bend point at the cursor and drag it
      if (arc.left < 0 || arc.right < 0) return; // panel border is fixed
      e.stopPropagation();
      const p = toWorld(e.clientX, e.clientY);
      const hit = nearestOnArc(arc, p);
      // near an interior point? drag that instead of inserting
      let idx = -1;
      for (let i = 1; i < arc.pts.length - 1; i++) {
        if (Math.hypot(arc.pts[i].x - hit.p.x, arc.pts[i].y - hit.p.y) < 6 / viewT.k) {
          idx = i;
          break;
        }
      }
      beginDrag();
      if (idx < 0) {
        applyGeometry((g) => {
          idx = insertArcPoint(g, arc.id, hit.segIdx, hit.p);
        });
      }
      dragRef.current = { kind: "arcpt", arcId: arc.id, idx };
      draggedRef.current = false;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } else if (tool === "erase") {
      if (arc.left < 0 || arc.right < 0) return;
      e.stopPropagation();
      const rl = graph.regions.get(arc.left);
      const rr = graph.regions.get(arc.right);
      const leftHex = rl ? graph.palette[rl.colorIdx]?.hex ?? "#888" : "#888";
      const rightHex = rr ? graph.palette[rr.colorIdx]?.hex ?? "#888" : "#888";
      if (leftHex === rightHex) {
        applyEdit((g) => void deleteArc(g, arc.id, "left"));
      } else {
        const rect = wrapRef.current!.getBoundingClientRect();
        setDeleteChoice({
          arcId: arc.id,
          screen: { x: e.clientX - rect.left, y: e.clientY - rect.top },
          leftHex,
          rightHex,
        });
      }
    } else if (tool === "draw") {
      e.stopPropagation();
      const p = toWorld(e.clientX, e.clientY);
      const hit = nearestOnArc(arc, p);
      if (!anchor) {
        setAnchor(hit);
        setCursor(hit.p);
        setDrawError(null);
      } else {
        if (hit.arcId === anchor.arcId && hit.segIdx === anchor.segIdx &&
            Math.hypot(hit.p.x - anchor.p.x, hit.p.y - anchor.p.y) < 4 / viewT.k) {
          return; // same spot
        }
        const a1 = graph.arcs.get(anchor.arcId)!;
        const a2 = arc;
        const shared = [a1.left, a1.right].filter(
          (r) => r >= 0 && (r === a2.left || r === a2.right)
        );
        if (shared.length === 0) {
          setDrawError("Both points must sit on the boundary of the same piece.");
          return;
        }
        // if two candidates (both arcs border the same two regions), pick the
        // region whose face contains the chord midpoint
        let regionId = shared[0];
        if (shared.length > 1) {
          const mid = { x: (anchor.p.x + hit.p.x) / 2, y: (anchor.p.y + hit.p.y) / 2 };
          for (const r of shared) {
            const f = faceByRegion.get(r);
            if (f && pointInFace(f, mid)) { regionId = r; break; }
          }
        }
        const snapPx = 6 / viewT.k;
        applyEdit((g) => void addLine(g, regionId, anchor, hit, snapPx));
        setAnchor(null);
        setCursor(null);
      }
    }
  };

  // handles for the selected piece (select tool)
  const handleArcs =
    tool === "select" && selectedRegion != null
      ? arcs.filter(
          (a) =>
            (a.left === selectedRegion || a.right === selectedRegion) &&
            a.left >= 0 &&
            a.right >= 0
        )
      : [];
  const handleNodeIds = new Set<number>();
  for (const a of handleArcs) {
    handleNodeIds.add(a.a);
    handleNodeIds.add(a.b);
  }

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-neutral-200 dark:bg-neutral-800">
      <svg
        ref={svgRef}
        className="h-full w-full touch-none"
        onWheel={onWheel}
        onPointerDown={onBackgroundDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHoverArc(null)}
      >
        <g ref={gRef} transform={`translate(${viewT.tx} ${viewT.ty}) scale(${viewT.k})`}>
          {/* panel backdrop */}
          <rect
            x={-2} y={-2}
            width={graph.width + 4} height={graph.height + 4}
            fill="#f7f3ea"
            stroke="none"
          />
          {/* pieces */}
          {faces.map((f) => {
            const region = graph.regions.get(f.regionId);
            const hex = region ? graph.palette[region.colorIdx]?.hex ?? "#999" : "#999";
            const isSel = f.regionId === selectedRegion;
            return (
              <path
                key={`f${f.regionId}`}
                d={facePathD(f)}
                fill={hex}
                fillRule="evenodd"
                opacity={isSel ? 1 : 0.96}
                stroke={isSel ? "#0a84ff" : "none"}
                strokeWidth={isSel ? 3 / viewT.k : 0}
                onPointerDown={(e) => {
                  if (tool === "select") {
                    e.stopPropagation();
                    onFaceClick(f);
                  }
                }}
                style={{ cursor: tool === "select" ? "pointer" : "crosshair" }}
              />
            );
          })}
          {/* lead/foil lines */}
          {arcs.map((a) => (
            <path
              key={`a${a.id}`}
              d={arcPathD(a)}
              fill="none"
              stroke={
                hoverArc === a.id && tool === "erase"
                  ? "#e0342f"
                  : hoverArc === a.id && (tool === "draw" || tool === "select")
                    ? "#0a84ff"
                    : lineColor
              }
              strokeWidth={leadWidthPx}
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="none"
            />
          ))}
          {/* invisible fat hit strokes on top */}
          {arcs.map((a) => {
            const border = a.left < 0 || a.right < 0;
            const interactive = tool === "draw" ? true : !border;
            if (!interactive) return null;
            return (
              <path
                key={`h${a.id}`}
                d={arcPathD(a)}
                fill="none"
                stroke="transparent"
                strokeWidth={hitWidthPx}
                strokeLinecap="round"
                onPointerDown={(e) => onArcPointerDown(a, e)}
                onPointerEnter={() => setHoverArc(a.id)}
                onPointerLeave={() => setHoverArc((h) => (h === a.id ? null : h))}
                style={{
                  cursor:
                    tool === "erase" ? "not-allowed" : tool === "draw" ? "crosshair" : "grab",
                }}
              />
            );
          })}
          {/* drag handles for selected piece */}
          {handleArcs.map((a) =>
            a.pts.slice(1, -1).map((p, i) => (
              <circle
                key={`p${a.id}-${i}`}
                cx={p.x} cy={p.y}
                r={3.2 / viewT.k}
                fill="#ffffff"
                stroke="#0a84ff"
                strokeWidth={1.4 / viewT.k}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  beginDrag();
                  dragRef.current = { kind: "arcpt", arcId: a.id, idx: i + 1 };
                  draggedRef.current = false;
                  (e.currentTarget as Element).setPointerCapture(e.pointerId);
                }}
                style={{ cursor: "move" }}
              />
            ))
          )}
          {[...handleNodeIds].map((nid) => {
            const n = graph.nodes.get(nid);
            if (!n) return null;
            const onBorder =
              n.p.x <= 0.01 || n.p.y <= 0.01 ||
              n.p.x >= graph.width - 0.01 || n.p.y >= graph.height - 0.01;
            if (onBorder) return null; // border nodes stay put
            return (
              <circle
                key={`n${nid}`}
                cx={n.p.x} cy={n.p.y}
                r={4.5 / viewT.k}
                fill="#0a84ff"
                stroke="#fff"
                strokeWidth={1.6 / viewT.k}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  beginDrag();
                  dragRef.current = { kind: "node", nodeId: nid };
                  draggedRef.current = false;
                  (e.currentTarget as Element).setPointerCapture(e.pointerId);
                }}
                style={{ cursor: "move" }}
              />
            );
          })}
          {/* draw preview */}
          {tool === "draw" && anchor && (
            <>
              <circle cx={anchor.p.x} cy={anchor.p.y} r={4 / viewT.k} fill="#0a84ff" />
              {cursor && (
                <line
                  x1={anchor.p.x} y1={anchor.p.y}
                  x2={cursor.x} y2={cursor.y}
                  stroke="#0a84ff"
                  strokeWidth={2 / viewT.k}
                  strokeDasharray={`${6 / viewT.k} ${4 / viewT.k}`}
                  pointerEvents="none"
                />
              )}
            </>
          )}
          {/* warning badges */}
          {faces
            .filter((f) => warnByRegion.has(f.regionId))
            .map((f) => (
              <g
                key={`w${f.regionId}`}
                transform={`translate(${f.labelPos.x} ${f.labelPos.y})`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  select(f.regionId);
                }}
                style={{ cursor: "pointer" }}
              >
                <circle r={8 / viewT.k} fill="#e0342f" stroke="#fff" strokeWidth={1.5 / viewT.k} />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#fff"
                  fontSize={11 / viewT.k}
                  fontWeight={700}
                >
                  !
                </text>
              </g>
            ))}
        </g>
      </svg>

      {/* zoom controls */}
      <div className="absolute right-3 top-3 flex flex-col gap-1">
        <button
          className="h-8 w-8 rounded-md border border-neutral-300 bg-white text-lg leading-none shadow-sm hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:hover:bg-neutral-800"
          onClick={() => setViewT((v) => ({ ...v, k: Math.min(40, v.k * 1.3) }))}
          title="Zoom in"
        >
          +
        </button>
        <button
          className="h-8 w-8 rounded-md border border-neutral-300 bg-white text-lg leading-none shadow-sm hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:hover:bg-neutral-800"
          onClick={() => setViewT((v) => ({ ...v, k: Math.max(0.2, v.k / 1.3) }))}
          title="Zoom out"
        >
          −
        </button>
        <button
          className="h-8 w-8 rounded-md border border-neutral-300 bg-white text-[10px] font-semibold shadow-sm hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:hover:bg-neutral-800"
          onClick={fitView}
          title="Fit to view"
        >
          FIT
        </button>
      </div>

      {/* delete color chooser */}
      {deleteChoice && (
        <div
          className="absolute z-10 flex items-center gap-2 rounded-lg border border-neutral-300 bg-white p-2 shadow-lg dark:border-neutral-600 dark:bg-neutral-900"
          style={{ left: deleteChoice.screen.x + 8, top: deleteChoice.screen.y + 8 }}
        >
          <span className="text-xs text-neutral-600 dark:text-neutral-300">Keep color:</span>
          {(["left", "right"] as const).map((side) => (
            <button
              key={side}
              className="h-7 w-7 rounded border border-neutral-400 transition-transform hover:scale-110"
              style={{
                background: side === "left" ? deleteChoice.leftHex : deleteChoice.rightHex,
              }}
              title={`Keep ${side} piece's color`}
              onClick={() => {
                applyEdit((g) => void deleteArc(g, deleteChoice.arcId, side));
                setDeleteChoice(null);
              }}
            />
          ))}
          <button
            className="ml-1 text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
            onClick={() => setDeleteChoice(null)}
          >
            ✕
          </button>
        </div>
      )}

      {drawError && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-red-600 px-3 py-1.5 text-sm text-white shadow">
          {drawError}
        </div>
      )}
      {tool === "draw" && !anchor && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-neutral-900/80 px-3 py-1.5 text-xs text-white shadow">
          Click a lead line to start the new cut, then click another point on the same piece&apos;s boundary.
        </div>
      )}
    </div>
  );
}

function pointInFace(f: Face, p: Pt): boolean {
  const inPoly = (pts: Pt[]) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const pi = pts[i], pj = pts[j];
      if (
        pi.y > p.y !== pj.y > p.y &&
        p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x
      )
        inside = !inside;
    }
    return inside;
  };
  return inPoly(f.outer.pts) && !f.holes.some((h) => inPoly(h.pts));
}
