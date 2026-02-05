"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchStore } from "@/app/store/searchStore";
import {
  buildQuery,
  logoFor,
  Platform,
  platformUrl,
} from "@/app/lib/searchLogic";

const PLATFORMS: { key: Platform; name: string; nameZh?: string }[] = [
  { key: "ebay", name: "eBay" },
  { key: "vinted", name: "Vinted" },
  { key: "depop", name: "Depop" },
  { key: "vestiaire", name: "Vestiaire" },
  { key: "etsy", name: "Etsy" },
  { key: "xianyu", name: "Xianyu", nameZh: "闲鱼" },
];

async function copyToClipboard(s: string) {
  try {
    await navigator.clipboard.writeText(s);
  } catch {
    // ignore
  }
}

type CropMode = "original" | "center" | "auto";

async function prepareCroppedImage(args: {
  file: File;
  mode: CropMode;
  bbox?: { x: number; y: number; w: number; h: number } | null;
}): Promise<File> {
  const { file, mode, bbox } = args;

  // Safari compatibility
  if (typeof (globalThis as any).createImageBitmap !== "function") return file;

  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return file;
  }

  let sx = 0;
  let sy = 0;
  let sw = bmp.width;
  let sh = bmp.height;

  if (mode === "center" || mode === "auto") {
    const size = Math.min(bmp.width, bmp.height);
    sx = Math.floor((bmp.width - size) / 2);

    // auto: for tall photos, bias crop slightly upward (bags/shoes often sit above center)
    const isTall = bmp.height > bmp.width * 1.2;
    const bias = mode === "auto" && isTall ? 0.18 : 0.5;
    sy = Math.floor((bmp.height - size) * bias);

    // clamp
    sy = Math.max(0, Math.min(sy, bmp.height - size));

    sw = size;
    sh = size;
  }

  // If vision provides bbox, auto mode uses bbox-based crop (square with padding)
  if (mode === "auto" && bbox && bbox.w > 0 && bbox.h > 0) { 
    const cx = (bbox.x + bbox.w / 2) * bmp.width;
    const cy = (bbox.y + bbox.h / 2) * bmp.height;
    const bw = bbox.w * bmp.width;
    const bh = bbox.h * bmp.height;

    const pad = 1.25;
    const size = Math.min(Math.max(bw, bh) * pad, Math.min(bmp.width, bmp.height));

    const left = Math.round(cx - size / 2);
    const top = Math.round(cy - size / 2);

    sx = Math.max(0, Math.min(left, bmp.width - size));
    sy = Math.max(0, Math.min(top, bmp.height - size));
    sw = size;
    sh = size;
  }

  // Compress for share / app upload reliability
  const MAX_EDGE = 1024;
  const scale = Math.min(1, MAX_EDGE / Math.max(sw, sh));
  const outW = Math.max(1, Math.round(sw * scale));
  const outH = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, outW, outH);

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85)
  );
  if (!blob) return file;

  const suffix = mode === "original" ? "" : mode === "center" ? "-center" : "-auto";
  const name = file.name.replace(/\.[^.]+$/, "") + suffix + ".jpg";
  return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
}

async function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name || "image.jpg";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

export default function DetailPage() {
  // Subscribe to each slice explicitly so UI always re-renders when chips/strategy/vision change.
  const lang = useSearchStore((s) => s.lang);
  const setLang = useSearchStore((s) => s.setLang);
  const text = useSearchStore((s) => s.text);
  const imageFile = useSearchStore((s) => s.imageFile);

  const langSwitchLabel = lang === "en" ? "切换简体中文" : "Change to English";
  const loading = useSearchStore((s) => s.loading);
  const err = useSearchStore((s) => s.err);
  const chips = useSearchStore((s) => s.chips);
  const vision = useSearchStore((s) => s.vision);
  const strategy = useSearchStore((s) => s.strategy);
  const setStrategy = useSearchStore((s) => s.setStrategy);
  const queryDirty = useSearchStore((s) => s.queryDirty);
  const queryOverride = useSearchStore((s) => s.queryOverride);
  const setQueryOverride = useSearchStore((s) => s.setQueryOverride);
  const clearQueryOverride = useSearchStore((s) => s.clearQueryOverride);
  const toggleChip = useSearchStore((s) => s.toggleChip);
  const deleteChip = useSearchStore((s) => s.deleteChip);
  const generate = useSearchStore((s) => s.generate);

  const [copied, setCopied] = useState(false);
  const [cropMode, setCropMode] = useState<CropMode>("auto");
  const [downloading, setDownloading] = useState(false);

  // Notion logging (dataset)
  const NOTION_DATABASE_ID = "2fd71368-38d5-8043-8d17-d70ea85ddca1";
  const [platformTag, setPlatformTag] = useState("eBay UK");
  const [bestQuery, setBestQuery] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);

  // Suggested query from feedback (server-side)
  const [suggestedQuery, setSuggestedQuery] = useState<string>("");
  const [suggestedMeta, setSuggestedMeta] = useState<string>("");

  const previewUrl = useMemo(() => {
    if (!imageFile) return null;
    return URL.createObjectURL(imageFile);
  }, [imageFile]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const didAutoGenerate = useRef(false);

  useEffect(() => {
    // Auto-generate when inputs arrive (navigation can mount before store updates land).
    if (didAutoGenerate.current) return;
    if (loading) return;
    if (chips.length > 0) return;

    if (imageFile || text.trim()) {
      didAutoGenerate.current = true;
      generate();
    }
  }, [chips.length, imageFile, text, loading, generate]);

  const autoQuery = buildQuery({ kind: strategy, chips, vision });
  const query = queryDirty ? queryOverride : autoQuery;

  useEffect(() => {
    // Keep bestQuery defaulted to the current auto query unless user edits it.
    if (!bestQuery) setBestQuery(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    // Pull suggested query from Notion feedback history.
    // We only do this for eBay UK initially.
    const p = platformTag || "eBay UK";
    if (!autoQuery || p !== "eBay UK") {
      setSuggestedQuery("");
      setSuggestedMeta("");
      return;
    }

    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const url = new URL("/api/feedback/suggest", window.location.origin);
        url.searchParams.set("platform", p);
        url.searchParams.set("autoQuery", autoQuery);

        const res = await fetch(url.toString(), { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;

        if (res.ok && json?.suggestedQuery && typeof json.suggestedQuery === "string") {
          setSuggestedQuery(json.suggestedQuery);
          setSuggestedMeta(json?.reason ? `${json.reason}${json.score ? ` (score ${Number(json.score).toFixed(2)})` : ""}` : "");
        } else {
          setSuggestedQuery("");
          setSuggestedMeta("");
        }
      } catch {
        if (cancelled) return;
        setSuggestedQuery("");
        setSuggestedMeta("");
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [autoQuery, platformTag]);

  useEffect(() => {
    // If user hasn't manually edited query, keep override synced.
    if (!queryDirty) {
      // ensure the displayed query follows chips/strategy
      // (query itself already uses autoQuery in this branch)
    }
  }, [autoQuery, queryDirty]);

  async function onDownloadImage(kind: "cropped" | "original") {
    if (!imageFile) {
      alert(lang === "zh" ? "请先上传图片。" : "Please upload an image first.");
      return;
    }

    setDownloading(true);
    try {
      const bbox = vision?.primaryObjectBBox ?? null;
      const out =
        kind === "original"
          ? await prepareCroppedImage({ file: imageFile, mode: "original", bbox })
          : await prepareCroppedImage({ file: imageFile, mode: cropMode, bbox });

      await downloadFile(out);
    } finally {
      setDownloading(false);
    }
  }

  async function onSaveToNotion() {
    setSavedUrl(null);
    setSaving(true);

    // Avoid "stuck" UI if the request hangs (e.g. network/Notion hiccup)
    const ctrl = new AbortController();
    const timeout = window.setTimeout(() => ctrl.abort(), 12000);

    try {
      const res = await fetch("/api/notion/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          databaseId: NOTION_DATABASE_ID,
          name: `sample ${new Date().toISOString().slice(0, 19)}`,
          platform: platformTag,
          queryMode: strategy,
          autoQuery,
          bestQuery: bestQuery || query,
          // imageUrl will be wired to Vercel Blob later
          imageUrl: "",
          visionJson: vision ? JSON.stringify(vision).slice(0, 2000) : "",
          notes,
        }),
        signal: ctrl.signal,
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as any)?.error || "Save failed");
      setSavedUrl((json as any)?.url || null);
    } catch (e: any) {
      const msg = e?.name === "AbortError" ? (lang === "zh" ? "请求超时，请重试" : "Request timed out, please retry") : e?.message;
      alert((lang === "zh" ? "保存失败：" : "Save failed: ") + (msg || ""));
    } finally {
      window.clearTimeout(timeout);
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[420px] px-5 py-6">
      {/* Top bar */}
      <div className="mb-4 flex items-center justify-between">
        <Link href="/" className="text-sm font-semibold text-zinc-600">
          ← {lang === "zh" ? "返回" : "Back"}
        </Link>
        <button
          className="text-sm font-semibold text-brand-900 underline underline-offset-4"
          onClick={() => setLang(lang === "en" ? "zh" : "en")}
        >
          {langSwitchLabel}
        </button>
      </div>

      <header className="mb-4">
        <h1 className="font-display text-[28px] leading-tight text-brand-900">
          {lang === "zh" ? "关键词" : "Your Key Word"}
        </h1>

        <div className="mt-1 text-xs font-semibold text-zinc-500">
          {lang === "zh"
            ? "说明：我们不抓取商品数据，只生成更好的搜索词，并跳转到平台搜索。"
            : "Note: We don’t scrape listings. We generate better search terms and jump to marketplace search."}
        </div>

        {lang === "zh" && (
          <div className="mt-1 text-xs font-semibold text-zinc-500">
            提示：为方便跨平台搜索，生成的关键词默认使用英文。
          </div>
        )}
      </header>

      {/* Image helper (crop/compress + download for app visual search) */}
      <section className="mb-5 rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="mb-2 text-sm font-semibold text-zinc-700">{lang === "zh" ? "图片辅助搜图" : "Image helper"}</div>

        {!imageFile && (
          <div className="text-sm font-semibold text-zinc-500">
            {lang === "zh" ? "上传图片后可裁剪/压缩并下载，用于平台 App 内的识图搜索。" : "Upload an image to crop/compress and download for in-app visual search."}
          </div>
        )}

        {imageFile && (
          <div className="flex items-start gap-3">
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="preview" className="h-16 w-16 rounded-xl border border-zinc-200 object-cover" />
            )}

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className={`rounded-xl px-3 py-2 text-xs font-extrabold ${cropMode === "auto" ? "bg-brand-500 text-white" : "border border-brand-500 bg-white text-zinc-900"}`}
                  onClick={() => setCropMode("auto")}
                  type="button"
                >
                  {lang === "zh" ? "智能裁剪" : "Smart crop"}
                </button>
                <button
                  className={`rounded-xl px-3 py-2 text-xs font-extrabold ${cropMode === "center" ? "bg-brand-500 text-white" : "border border-brand-500 bg-white text-zinc-900"}`}
                  onClick={() => setCropMode("center")}
                  type="button"
                >
                  {lang === "zh" ? "居中裁剪" : "Center"}
                </button>
                <button
                  className={`rounded-xl px-3 py-2 text-xs font-extrabold ${cropMode === "original" ? "bg-brand-500 text-white" : "border border-brand-500 bg-white text-zinc-900"}`}
                  onClick={() => setCropMode("original")}
                  type="button"
                >
                  {lang === "zh" ? "原图" : "Original"}
                </button>

                <button
                  className="ml-auto inline-flex items-center justify-center rounded-xl bg-emerald-600 px-3 py-2 text-xs font-extrabold text-white disabled:opacity-60"
                  onClick={() => onDownloadImage("cropped")}
                  disabled={downloading}
                  type="button"
                >
                  {downloading ? (lang === "zh" ? "处理中…" : "Preparing…") : lang === "zh" ? "下载裁剪图" : "Download crop"}
                </button>

                <button
                  className="inline-flex items-center justify-center rounded-xl border border-emerald-600 bg-white px-3 py-2 text-xs font-extrabold text-emerald-700 disabled:opacity-60"
                  onClick={() => onDownloadImage("original")}
                  disabled={downloading}
                  type="button"
                >
                  {lang === "zh" ? "下载原图" : "Download original"}
                </button>
              </div>

              <div className="mt-2 text-xs font-semibold text-zinc-500">
                {lang === "zh"
                  ? "如果文字搜索结果不准确，可下载这张图片，在平台 App 内使用“识图/相机”进行图片搜索。"
                  : "If text results are inaccurate, download the image and use visual search/camera inside the marketplace app."}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Actions */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-semibold text-brand-900"
          onClick={async () => {
            await copyToClipboard(query);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {lang === "zh" ? "复制关键词" : "Copy key word"}
        </button>

        <button
          className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-semibold text-brand-900"
          onClick={() => {
            // reserved for future: editing keywords/query
            // Keeping behavior minimal to avoid diverging from the prototype.
            alert(lang === "zh" ? "暂未实现编辑功能（仅 UI 占位）。" : "Edit is not implemented yet (UI only). ");
          }}
        >
          {lang === "zh" ? "编辑" : "Edit"}
        </button>

        <button
          className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-semibold text-brand-900"
          onClick={() => {
            // You said keywords are always English; keep button for parity, no-op for now.
            alert(lang === "zh" ? "为方便跨平台搜索，关键词默认使用英文。" : "Keywords are already English in this prototype.");
          }}
        >
          {lang === "zh" ? "翻译为英文" : "Translate key word"}
        </button>

        {copied && <span className="self-center text-xs font-semibold text-emerald-600">Copied</span>}
      </div>

      {/* Query mode */}
      <section className="mb-5 rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="mb-2 text-sm font-semibold text-zinc-700">{lang === "zh" ? "关键词模式" : "Query mode"}</div>
        <div className="grid gap-2">
          <button
            className={`rounded-xl px-3 py-3 text-sm font-extrabold ${strategy === "broad" ? "bg-brand-500 text-white" : "border border-brand-500 bg-white text-zinc-900"}`}
            onClick={() => setStrategy("broad")}
          >
            {lang === "zh" ? "宽泛（推荐）" : "Broad (best default)"}
          </button>
          <button
            className={`rounded-xl px-3 py-3 text-sm font-extrabold ${strategy === "exact" ? "bg-brand-500 text-white" : "border border-brand-500 bg-white text-zinc-900"}`}
            onClick={() => setStrategy("exact")}
          >
            {lang === "zh" ? "精确（更精确）" : "Exact (if confident)"}
          </button>
          <button
            className={`rounded-xl px-3 py-3 text-sm font-extrabold ${strategy === "strict" ? "bg-brand-500 text-white" : "border border-brand-500 bg-white text-zinc-900"}`}
            onClick={() => setStrategy("strict")}
          >
            {lang === "zh" ? "严格（仅正品）" : "Strict (authentic only)"}
          </button>

          {/* Keep prototype-only chips mode but de-emphasize it */}
          <button
            className={`rounded-xl px-3 py-3 text-sm font-extrabold ${strategy === "chips" ? "bg-brand-500 text-white" : "border border-brand-500/60 bg-white text-zinc-900"}`}
            onClick={() => setStrategy("chips")}
          >
            {lang === "zh" ? "关键词选择（高级）" : "Chips (advanced)"}
          </button>
        </div>
      </section>

      {/* Query */}
      <section className="mb-5 rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="mb-2 text-sm font-semibold text-zinc-700">{lang === "zh" ? "关键词" : "Query"}</div>

        {suggestedQuery && suggestedQuery !== autoQuery && (
          <div className="mb-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <div className="text-xs font-extrabold text-emerald-700">
              {lang === "zh" ? "建议搜索词（来自历史反馈）" : "Suggested (from feedback)"}
              {suggestedMeta ? ` · ${suggestedMeta}` : ""}
            </div>
            <div className="mt-1 font-semibold text-zinc-900">{suggestedQuery}</div>
            <div className="mt-2">
              <button
                className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-extrabold text-white"
                type="button"
                onClick={() => setQueryOverride(suggestedQuery)}
              >
                {lang === "zh" ? "使用这条" : "Use this"}
              </button>
            </div>
          </div>
        )}
        {loading && (
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-600">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-brand-500" />
            <span>Generating…</span>
          </div>
        )}

        <textarea
          className="w-full rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm font-semibold text-zinc-900"
          value={loading ? "" : query}
          onChange={(e) => setQueryOverride(e.target.value)}
          placeholder={loading ? "" : ""}
          rows={3}
          readOnly={loading}
        />

        <div className="mt-2 flex items-center gap-2">
          <button
            className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-60"
            onClick={async () => {
              await copyToClipboard(query);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            disabled={!query || loading}
            type="button"
          >
            {lang === "zh" ? "复制" : "COPY"}
          </button>

          {queryDirty && (
            <button
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-extrabold text-zinc-700"
              onClick={() => clearQueryOverride()}
              type="button"
            >
              {lang === "zh" ? "重置" : "Reset"}
            </button>
          )}

          {copied && <span className="text-xs font-semibold text-emerald-600">Copied</span>}
        </div>
        {err && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">
            {err}
          </div>
        )}
      </section>

      {/* Keywords (chips) */}
      {chips.length > 0 && (
        <section className="mb-5 rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="mb-2 text-sm font-semibold text-zinc-700">{lang === "zh" ? "识别到的关键词" : "Detected keywords"}</div>
          <div className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <div
                key={c.id}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${c.on ? "border-brand-500 bg-brand-500 text-white" : "border-zinc-200 bg-white text-zinc-800"}`}
              >
                <button className="cursor-pointer" onClick={() => toggleChip(c.id)} title="toggle">
                  {c.text}
                </button>
                <button
                  className="cursor-pointer opacity-80"
                  onClick={() => deleteChip(c.id)}
                  title="delete"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Platforms */}
      <section className="grid gap-3">
        {PLATFORMS.map((p) => {
          const url = platformUrl(p.key, query, vision, chips);

          return (
            <div
              key={p.key}
              className={`flex items-center justify-between rounded-2xl border px-4 py-3 ${p.key === "ebay" ? "border-emerald-300 bg-emerald-50" : "border-emerald-200 bg-white"}`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoFor(p.key)} alt={p.name} className="h-7 w-auto flex-none" />
                <div className="min-w-0 truncate whitespace-nowrap text-base font-extrabold text-zinc-900">
                  {lang === "zh" ? p.nameZh ?? p.name : p.name}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="hidden sm:block rounded-full border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-extrabold text-zinc-600">
                  {p.key === "ebay" || p.key === "vinted" || p.key === "xianyu"
                    ? lang === "zh"
                      ? "支持图片搜索"
                      : "Image search supported"
                    : lang === "zh"
                      ? "仅文字"
                      : "Text only"}
                </div>

                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-extrabold text-white"
                >
                  {lang === "zh" ? "文字" : "Text"} <span className="text-sm">→</span>
                </a>
              </div>
            </div>
          );
        })}
      </section>

      {/* Save to Notion (labeling) */}
      <section className="mt-6 mb-5 rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="mb-2 text-sm font-semibold text-zinc-700">{lang === "zh" ? "保存到 Notion（标注）" : "Save to Notion (label)"}</div>

        <div className="grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <select
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900"
              value={platformTag}
              onChange={(e) => setPlatformTag(e.target.value)}
            >
              <option>eBay UK</option>
              <option>Vinted</option>
              <option>Xianyu</option>
            </select>

            <select
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as any)}
            >
              <option value="broad">broad</option>
              <option value="exact">exact</option>
              <option value="strict">strict</option>
              <option value="chips">chips</option>
            </select>
          </div>

          <div className="text-xs font-semibold text-zinc-500">
            {lang === "zh" ? "Auto Query（自动）" : "Auto Query"}: {autoQuery || "—"}
          </div>

          <input
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900"
            value={bestQuery}
            onChange={(e) => setBestQuery(e.target.value)}
            placeholder={lang === "zh" ? "Best Query（你确认最像的一条）" : "Best Query (your best)"}
          />

          <textarea
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder={lang === "zh" ? "备注：为什么这条 query 更像？" : "Notes: why is this better?"}
          />

          <div className="flex items-center gap-2">
            <button
              className="rounded-xl bg-brand-500 px-3 py-2 text-sm font-extrabold text-white disabled:opacity-60"
              onClick={onSaveToNotion}
              disabled={saving}
              type="button"
            >
              {saving ? (lang === "zh" ? "保存中…" : "Saving…") : lang === "zh" ? "保存" : "Save"}
            </button>

            {savedUrl && (
              <a className="text-sm font-semibold text-emerald-700 underline" href={savedUrl} target="_blank" rel="noreferrer">
                {lang === "zh" ? "已保存，打开 Notion" : "Saved, open Notion"}
              </a>
            )}
          </div>

          <div className="text-xs font-semibold text-zinc-500">
            {lang === "zh" ? "提示：图片 URL 还未接入存储，当前仅保存 query/识别结果。" : "Note: image URL upload is not wired yet; saving queries/vision only."}
          </div>
        </div>
      </section>


      <footer className="mt-8 flex justify-center">
        <img
          src="/prelovefinder-logo.png"
          alt="PreloveFinder"
          className="h-16 w-auto"
        />
      </footer>
    </main>
  );
}
