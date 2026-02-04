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

type ShareCrop = "none" | "square";

async function prepareShareImage(args: { file: File; crop: ShareCrop }): Promise<File> {
  const { file, crop } = args;

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

  if (crop === "square") {
    const size = Math.min(bmp.width, bmp.height);
    sx = Math.floor((bmp.width - size) / 2);
    sy = Math.floor((bmp.height - size) / 2);
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

  const name = file.name.replace(/\.[^.]+$/, "") + (crop === "square" ? "-square" : "") + ".jpg";
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
  const toggleChip = useSearchStore((s) => s.toggleChip);
  const deleteChip = useSearchStore((s) => s.deleteChip);
  const generate = useSearchStore((s) => s.generate);

  const [copied, setCopied] = useState(false);
  const [shareCrop, setShareCrop] = useState<ShareCrop>("square");
  const [sharing, setSharing] = useState(false);

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

  const query = buildQuery({ kind: strategy, chips, vision });

  const canNativeShare = typeof navigator !== "undefined" && typeof (navigator as any).share === "function";

  async function onShareImageToApp() {
    if (!imageFile) {
      alert(lang === "zh" ? "请先上传图片。" : "Please upload an image first.");
      return;
    }

    setSharing(true);
    try {
      const shareFile = await prepareShareImage({ file: imageFile, crop: shareCrop });

      // Prefer system share sheet (Safari iOS)
      if (canNativeShare && typeof (navigator as any).canShare === "function") {
        const ok = (navigator as any).canShare({ files: [shareFile] });
        if (ok) {
          await (navigator as any).share({
            title: "PreloveFinder",
            text: query ? `query: ${query}` : undefined,
            files: [shareFile],
          });
          return;
        }
      }

      if (canNativeShare) {
        // Some Safari builds don't support canShare; try anyway.
        try {
          await (navigator as any).share({
            title: "PreloveFinder",
            text: query ? `query: ${query}` : undefined,
            files: [shareFile],
          });
          return;
        } catch {
          // fall through
        }
      }

      // Fallback: download image, user opens app and uploads
      await downloadFile(shareFile);
      alert(
        lang === "zh"
          ? "已下载图片。请打开对应平台 App → 识图/相机 → 选择刚保存的图片。"
          : "Image downloaded. Open the platform app → visual search/camera → pick the saved image."
      );
    } finally {
      setSharing(false);
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
        {lang === "zh" && (
          <div className="mt-1 text-xs font-semibold text-zinc-500">
            提示：为方便跨平台搜索，生成的关键词默认使用英文。
          </div>
        )}
      </header>

      {/* Image share (visual search entry) */}
      <section className="mb-5 rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="mb-2 text-sm font-semibold text-zinc-700">{lang === "zh" ? "识图入口" : "Visual search entry"}</div>

        {!imageFile && (
          <div className="text-sm font-semibold text-zinc-500">
            {lang === "zh" ? "上传图片后，可通过系统分享直接在 App 内识图。" : "Upload an image to share it into apps for visual search."}
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
                  className={`rounded-xl px-3 py-2 text-xs font-extrabold ${shareCrop === "square" ? "bg-brand-500 text-white" : "border border-brand-500 bg-white text-zinc-900"}`}
                  onClick={() => setShareCrop("square")}
                  type="button"
                >
                  {lang === "zh" ? "居中裁剪" : "Center crop"}
                </button>
                <button
                  className={`rounded-xl px-3 py-2 text-xs font-extrabold ${shareCrop === "none" ? "bg-brand-500 text-white" : "border border-brand-500 bg-white text-zinc-900"}`}
                  onClick={() => setShareCrop("none")}
                  type="button"
                >
                  {lang === "zh" ? "原图" : "Original"}
                </button>

                <button
                  className="ml-auto inline-flex items-center justify-center rounded-xl bg-emerald-600 px-3 py-2 text-xs font-extrabold text-white disabled:opacity-60"
                  onClick={onShareImageToApp}
                  disabled={sharing}
                  type="button"
                >
                  {sharing ? (lang === "zh" ? "处理中…" : "Preparing…") : lang === "zh" ? "分享图片到 App" : "Share to app"}
                </button>
              </div>

              <div className="mt-2 text-xs font-semibold text-zinc-500">
                {lang === "zh"
                  ? "提示：浏览器无法自动上传图片到平台。分享后在平台 App 内使用识图/相机选择同一张图片。"
                  : "Note: browsers can't auto-upload files to other sites. After sharing, use visual search/camera inside the app."}
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
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm font-semibold text-zinc-900">
          {loading ? (
            <div className="flex items-center gap-2">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-brand-500" />
              <span>Generating…</span>
            </div>
          ) : (
            query || "—"
          )}
        </div>

        <button
          className="mt-3 inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-extrabold text-white"
          onClick={async () => {
            await copyToClipboard(query);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          disabled={!query || loading}
        >
          {lang === "zh" ? "复制" : "COPY"}
        </button>

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
                <button
                  className="rounded-xl border border-brand-500 bg-white px-3 py-2 text-xs font-extrabold text-zinc-900 disabled:opacity-60"
                  title={lang === "zh" ? "通过系统分享把图片发送到平台 App 进行识图" : "Share the image into apps for visual search"}
                  onClick={onShareImageToApp}
                  disabled={!imageFile || sharing}
                  type="button"
                >
                  {lang === "zh" ? "识图" : "Image"}
                </button>

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

      <footer className="mt-8 text-center font-display text-xl text-brand-900">PreloveFinder</footer>
    </main>
  );
}
