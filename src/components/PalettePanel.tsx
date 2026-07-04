"use client";

import { useApp } from "@/store";
import { recolor } from "@/lib/graph";

export default function PalettePanel() {
  const graph = useApp((s) => s.graph);
  const version = useApp((s) => s.version);
  const selectedRegion = useApp((s) => s.selectedRegion);
  const applyEdit = useApp((s) => s.applyEdit);
  const setPaletteFlag = (idx: number, directional: boolean) => {
    // palette flags don't change topology; mutate + bump via applyEdit-less path
    useApp.setState((st) => {
      if (!st.graph) return st;
      st.graph.palette[idx] = { ...st.graph.palette[idx], directional };
      return { version: st.version + 1 };
    });
  };

  void version;
  if (!graph) return null;

  const selColor =
    selectedRegion != null ? graph.regions.get(selectedRegion)?.colorIdx : undefined;

  return (
    <div className="flex flex-col gap-2 p-4 pt-0">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Palette{" "}
        {selectedRegion != null && (
          <span className="normal-case font-normal">— click a swatch to recolor the selected piece</span>
        )}
      </span>
      <div className="flex flex-col gap-1">
        {graph.palette.map((c, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <button
              className={`h-7 w-10 shrink-0 rounded border ${
                selColor === idx
                  ? "border-blue-500 ring-2 ring-blue-400"
                  : "border-neutral-400/60"
              }`}
              style={{ background: c.hex }}
              title={
                selectedRegion != null
                  ? `Recolor selected piece to ${c.hex}`
                  : c.hex
              }
              onClick={() => {
                if (selectedRegion != null) {
                  applyEdit((g) => recolor(g, selectedRegion, idx));
                }
              }}
            />
            <span className="w-16 font-mono text-xs text-neutral-600 dark:text-neutral-300">
              {c.hex}
            </span>
            <label className="ml-auto flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
              <input
                type="checkbox"
                className="accent-blue-500"
                checked={c.directional}
                onChange={(e) => setPaletteFlag(idx, e.target.checked)}
              />
              streaky / directional
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
