"use client";

import { useRef } from "react";
import { useApp } from "@/store";
import { BUCKET_RANGES, type Settings } from "@/lib/types";
import { makeSampleImage } from "@/lib/sample";

const CAME_WIDTHS: { label: string; value: number }[] = [
  { label: '1/8"', value: 1 / 8 },
  { label: '5/32"', value: 5 / 32 },
  { label: '3/16"', value: 3 / 16 },
  { label: '1/4"', value: 1 / 4 },
  { label: '3/8"', value: 3 / 8 },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800";

export default function ControlsPanel() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const setImage = useApp((s) => s.setImage);
  const image = useApp((s) => s.image);
  const imageName = useApp((s) => s.imageName);
  const generate = useApp((s) => s.generate);
  const generating = useApp((s) => s.generating);
  const fileRef = useRef<HTMLInputElement>(null);

  const bucket = settings.colorBucket;
  const [lo, hi] = BUCKET_RANGES[bucket];

  const onFile = async (file: File) => {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("Could not read image"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setImage({ width: canvas.width, height: canvas.height, data: data.data }, file.name);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const setBucket = (b: Settings["colorBucket"]) => {
    const [nlo, nhi] = BUCKET_RANGES[b];
    const clamped = Math.min(nhi, Math.max(nlo, settings.colorCount));
    setSettings({ colorBucket: b, colorCount: clamped });
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* image */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Reference image
        </span>
        <div className="flex gap-2">
          <button
            className="flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
            onClick={() => fileRef.current?.click()}
          >
            Upload…
          </button>
          <button
            className="flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
            onClick={() => setImage(makeSampleImage(), "Sample: sunrise lake")}
          >
            Use sample
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
        <p className="text-xs text-neutral-500">
          {image ? (
            <>
              <span className="font-medium text-neutral-700 dark:text-neutral-300">{imageName}</span>{" "}
              ({image.width}×{image.height}) — processed entirely in your browser; never uploaded.
            </>
          ) : (
            "Processed entirely in your browser; never uploaded."
          )}
        </p>
      </div>

      {/* dimensions */}
      <div className="grid grid-cols-3 gap-2">
        <Field label="Width">
          <input
            type="number" min={1} className={inputCls}
            value={settings.widthValue}
            onChange={(e) => setSettings({ widthValue: Number(e.target.value) || 1 })}
          />
        </Field>
        <Field label="Height">
          <input
            type="number" min={1} className={inputCls}
            value={settings.heightValue}
            onChange={(e) => setSettings({ heightValue: Number(e.target.value) || 1 })}
          />
        </Field>
        <Field label="Units">
          <select
            className={inputCls}
            value={settings.units}
            onChange={(e) => setSettings({ units: e.target.value as Settings["units"] })}
          >
            <option value="mm">mm</option>
            <option value="cm">cm</option>
            <option value="in">in</option>
          </select>
        </Field>
      </div>
      <p className="-mt-2 text-xs text-neutral-500">
        The image is center-cropped to this aspect ratio so shapes stay true to scale.
      </p>

      {/* colors */}
      <Field label="Colors">
        <div className="flex gap-1">
          {(
            [
              ["lt5", "< 5"],
              ["5to10", "5–10"],
              ["10to20", "10–20"],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              className={`flex-1 rounded-md border px-2 py-1.5 text-sm ${
                bucket === val
                  ? "border-blue-500 bg-blue-500/10 font-semibold text-blue-600 dark:text-blue-400"
                  : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
              }`}
              onClick={() => setBucket(val)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="range" min={lo} max={hi} step={1}
            value={settings.colorCount}
            className="flex-1 accent-blue-500"
            onChange={(e) => setSettings({ colorCount: Number(e.target.value) })}
          />
          <span className="w-6 text-right text-sm tabular-nums">{settings.colorCount}</span>
        </div>
      </Field>

      {/* density */}
      <Field label="Line density (piece count)">
        <div className="flex gap-1">
          {(["low", "medium", "high"] as const).map((d) => (
            <button
              key={d}
              className={`flex-1 rounded-md border px-2 py-1.5 text-sm capitalize ${
                settings.density === d
                  ? "border-blue-500 bg-blue-500/10 font-semibold text-blue-600 dark:text-blue-400"
                  : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
              }`}
              onClick={() => setSettings({ density: d })}
            >
              {d}
            </button>
          ))}
        </div>
      </Field>

      {/* assembly */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Assembly">
          <select
            className={inputCls}
            value={settings.assembly}
            onChange={(e) => setSettings({ assembly: e.target.value as Settings["assembly"] })}
          >
            <option value="lead">Lead came</option>
            <option value="foil">Copper foil</option>
          </select>
        </Field>
        {settings.assembly === "lead" ? (
          <Field label="Came width">
            <select
              className={inputCls}
              value={settings.cameWidthIn}
              onChange={(e) => setSettings({ cameWidthIn: Number(e.target.value) })}
            >
              {CAME_WIDTHS.map((c) => (
                <option key={c.label} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Skill level">
            <SkillSelect />
          </Field>
        )}
      </div>
      {settings.assembly === "lead" && (
        <Field label="Skill level">
          <SkillSelect />
        </Field>
      )}

      <button
        className="mt-1 rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white shadow hover:bg-blue-500 disabled:opacity-40"
        disabled={!image || generating}
        onClick={generate}
      >
        {generating ? "Generating…" : "Generate pattern"}
      </button>
    </div>
  );
}

function SkillSelect() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  return (
    <select
      className={inputCls}
      value={settings.skill}
      onChange={(e) => setSettings({ skill: e.target.value as Settings["skill"] })}
    >
      <option value="beginner">Beginner (+25% breakage)</option>
      <option value="intermediate">Intermediate (+15%)</option>
      <option value="advanced">Advanced (+10%)</option>
    </select>
  );
}
