"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchStore } from "@/app/store/searchStore";
import {
  buildQuery,
  logoFor,
  Platform,
  platformImageSearchUrl,
  platformUrl,
} from "@/app/lib/searchLogic";

const PLATFORMS: { key: Platform; name: string }[] = [
  { key: "ebay", name: "eBay" },
  { key: "vinted", name: "Vinted" },
  { key: "depop", name: "Depop" },
  { key: "vestiaire", name: "Vestiaire" },
  { key: "etsy", name: "Etsy" },
  { key: "xianyu", name: "Xianyu" },
];

async function copyToClipboard(s: string) {
  try {
    await navigator.clipboard.writeText(s);
  } catch {
    // ignore
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
          const imgUrl = platformImageSearchUrl(p.key);

          return (
            <div
              key={p.key}
              className={`flex items-center justify-between rounded-2xl border px-4 py-3 ${p.key === "ebay" ? "border-emerald-300 bg-emerald-50" : "border-emerald-200 bg-white"}`}
            >
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoFor(p.key)} alt={p.name} className="h-7 w-auto" />
                <div className="text-base font-extrabold text-zinc-900">{p.name}</div>
              </div>

              <div className="flex items-center gap-2">
                {imgUrl && (
                  <a
                    href={imgUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-brand-500 bg-white px-3 py-2 text-xs font-extrabold text-zinc-900"
                    title={lang === "zh" ? "打开平台识图入口（需手动上传图片）" : "Open image search entry (manual upload)"}
                  >
                    {lang === "zh" ? "识图" : "Image"}
                  </a>
                )}

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
