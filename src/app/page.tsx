"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useApp, pxToMmScale } from "@/store";
import ControlsPanel from "@/components/ControlsPanel";
import PalettePanel from "@/components/PalettePanel";
import WarningsPanel from "@/components/WarningsPanel";
import PlanView from "@/components/PlanView";

const EditorCanvas = dynamic(() => import("@/components/EditorCanvas"), { ssr: false });

const toolBtn = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? "bg-blue-600 text-white shadow"
      : "text-neutral-600 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-700"
  }`;

export default function Home() {
  const graph = useApp((s) => s.graph);
  const faces = useApp((s) => s.faces);
  const tool = useApp((s) => s.tool);
  const setTool = useApp((s) => s.setTool);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const undo = useApp((s) => s.undo);
  const undoDepth = useApp((s) => s.undoStack.length);
  const settings = useApp((s) => s.settings);
  const [exporting, setExporting] = useState(false);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      } else if (e.key === "v") setTool("select");
      else if (e.key === "l") setTool("draw");
      else if (e.key === "e") setTool("erase");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, setTool]);

  const exportPdf = async () => {
    const st = useApp.getState();
    if (!st.graph) return;
    setExporting(true);
    try {
      const { buildPatternPdf } = await import("@/lib/pdf/exportPdf");
      const bytes = await buildPatternPdf({
        graph: st.graph,
        faces: st.faces,
        settings: st.settings,
        pxToMm: pxToMmScale(st.settings, st.graph),
      });
      const blob = new Blob([bytes as unknown as ArrayBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "patternforge-pattern.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      console.error(e);
      alert("PDF export failed: " + (e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex h-screen flex-col">
      {/* header */}
      <header className="flex items-center gap-4 border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="text-base font-bold tracking-tight">
          <span className="text-blue-600">Pattern</span>Forge
        </h1>
        <span className="hidden text-xs text-neutral-400 sm:block">
          reference image → editable, printable, to-scale stained glass pattern
        </span>

        {graph && (
          <>
            <nav className="ml-4 flex rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
              {(["editor", "plan"] as const).map((v) => (
                <button key={v} className={toolBtn(view === v)} onClick={() => setView(v)}>
                  {v === "editor" ? "Editor" : "Plan"}
                </button>
              ))}
            </nav>
            {view === "editor" && (
              <div className="flex items-center gap-1 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
                <button
                  className={toolBtn(tool === "select")}
                  title="Select & move lines (V)"
                  onClick={() => setTool("select")}
                >
                  Select
                </button>
                <button
                  className={toolBtn(tool === "draw")}
                  title="Add a line: split a piece in two (L)"
                  onClick={() => setTool("draw")}
                >
                  + Line
                </button>
                <button
                  className={toolBtn(tool === "erase")}
                  title="Delete a line: merge two pieces (E)"
                  onClick={() => setTool("erase")}
                >
                  − Line
                </button>
                <button
                  className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-200 disabled:opacity-30 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  disabled={undoDepth === 0}
                  title="Undo (⌘Z)"
                  onClick={undo}
                >
                  ↩ Undo
                </button>
              </div>
            )}
          </>
        )}

        <div className="ml-auto flex items-center gap-3">
          {graph && (
            <span className="text-xs text-neutral-500">
              {faces.length} pieces · {settings.widthValue}×{settings.heightValue} {settings.units}
            </span>
          )}
          <button
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white shadow hover:bg-emerald-500 disabled:opacity-40"
            disabled={!graph || exporting}
            onClick={exportPdf}
          >
            {exporting ? "Exporting…" : "Export PDF"}
          </button>
        </div>
      </header>

      {/* body */}
      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <ControlsPanel />
          {graph && (
            <>
              <PalettePanel />
              <WarningsPanel />
            </>
          )}
        </aside>
        <main className="min-w-0 flex-1 overflow-hidden">
          {!graph ? (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-md p-8 text-center text-neutral-500">
                <div className="mb-3 text-5xl">⛪</div>
                <h2 className="mb-2 text-lg font-semibold text-neutral-700 dark:text-neutral-200">
                  Turn any image into a stained glass pattern
                </h2>
                <p className="text-sm">
                  Upload a reference image (or use the sample), set your finished panel size,
                  choose colors and piece density, then hit <em>Generate pattern</em>. Everything
                  runs locally in your browser.
                </p>
              </div>
            </div>
          ) : view === "editor" ? (
            <EditorCanvas />
          ) : (
            <div className="h-full overflow-y-auto">
              <PlanView />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
