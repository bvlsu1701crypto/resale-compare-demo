"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { TEXT } from "@/app/text";
import { useSearchStore } from "@/app/store/searchStore";

export default function MainPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const lang = useSearchStore((s) => s.lang);
  const text = useSearchStore((s) => s.text);
  const setLang = useSearchStore((s) => s.setLang);
  const setText = useSearchStore((s) => s.setText);
  const setImageFile = useSearchStore((s) => s.setImageFile);
  const resetOutputs = useSearchStore((s) => s.resetOutputs);

  const t = TEXT[lang];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col items-stretch px-5 py-10">
      {/* Center block (matches the mobile UI comp) */}
      <div className="flex flex-1 flex-col justify-center">
        {/* Brand */}
        <div className="flex w-full justify-center pb-10">
          <img
            src="/prelovefinder-logo.png"
            alt={t.title}
            className="h-24 w-auto"
          />
        </div>

        {/* Upload */}
        <button
          className="rounded-2xl bg-brand-500 px-4 py-4 text-center text-sm font-extrabold text-white shadow-sm"
          onClick={() => fileRef.current?.click()}
        >
          {t.upload}
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (!f) return;

            // Clear previous outputs so Detail can auto-generate.
            resetOutputs();
            setImageFile(f);
            router.push("/detail");
          }}
        />

        {/* Text input */}
        <div className="mt-4">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.placeholder}
            className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-900 placeholder:text-zinc-400 focus:border-brand-500 focus:outline-none"
          />
        </div>

        {/* Search button (text-only flow) */}
        <button
          className="mt-3 rounded-2xl border border-brand-200 bg-white px-4 py-3 text-sm font-extrabold text-brand-900"
          onClick={() => {
            resetOutputs();
            setImageFile(null);
            router.push("/detail");
          }}
        >
          {t.search}
        </button>
      </div>

      {/* Language switch */}
      <button
        className="pt-10 text-center font-display text-sm font-semibold text-brand-900 underline decoration-brand-900 underline-offset-4"
        onClick={() => setLang(lang === "en" ? "zh" : "en")}
      >
        {t.switchTo}
      </button>
    </main>
  );
}
