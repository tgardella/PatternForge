"use client";

import { useApp } from "@/store";

const KIND_LABEL: Record<string, string> = {
  hole: "Hole",
  sliver: "Sliver",
  concave: "Deep notch",
};

export default function WarningsPanel() {
  const warnings = useApp((s) => s.warnings);
  const select = useApp((s) => s.select);
  const selectedRegion = useApp((s) => s.selectedRegion);

  if (warnings.length === 0) {
    return (
      <div className="p-4 pt-0 text-xs text-emerald-600 dark:text-emerald-400">
        ✓ All pieces look cuttable.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 p-4 pt-0">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Cuttability warnings ({warnings.length})
      </span>
      <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
        {warnings.map((w, i) => (
          <button
            key={i}
            className={`rounded-md border px-2 py-1.5 text-left text-xs ${
              selectedRegion === w.regionId
                ? "border-blue-500 bg-blue-500/10"
                : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            }`}
            onClick={() => select(w.regionId)}
          >
            <span
              className={`mr-1 rounded px-1 font-semibold ${
                w.kind === "hole"
                  ? "bg-red-500/15 text-red-600 dark:text-red-400"
                  : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
              }`}
            >
              {KIND_LABEL[w.kind]}
            </span>
            {w.message}
          </button>
        ))}
      </div>
    </div>
  );
}
