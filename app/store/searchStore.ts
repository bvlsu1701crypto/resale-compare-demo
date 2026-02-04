"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  buildQuery,
  Chip,
  cleanToken,
  normalizeSpaces,
  Strategy,
  uniq,
} from "@/app/lib/searchLogic";

type Lang = "en" | "zh";

type SearchState = {
  // inputs
  lang: Lang;
  text: string;
  imageFile: File | null;

  // outputs
  loading: boolean;
  err: string | null;
  vision: any;
  chips: Chip[];
  strategy: Strategy;

  // query editing
  queryOverride: string;
  queryDirty: boolean;

  // actions
  setLang: (lang: Lang) => void;
  setText: (text: string) => void;
  setImageFile: (f: File | null) => void;
  setStrategy: (s: Strategy) => void;
  toggleChip: (id: string) => void;
  deleteChip: (id: string) => void;
  resetOutputs: () => void;

  setQueryOverride: (q: string) => void;
  clearQueryOverride: () => void;

  generate: () => Promise<void>;
  activeQuery: () => string;
};

async function downscaleImage(file: File): Promise<File> {
  // Reduce large images to avoid oversized data URLs / model limits.
  // Target: max 1600px on the long edge, JPEG quality 0.85.
  // Must be robust across browsers (some Safari builds lack createImageBitmap).
  const MAX_EDGE = 1600;
  const QUALITY = 0.85;

  // If already small-ish, keep as-is.
  if (file.size <= 2_000_000) return file;

  if (typeof (globalThis as any).createImageBitmap !== "function") {
    // Fallback: no downscale support, upload original.
    return file;
  }

  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return file;
  }

  const w = bmp.width;
  const h = bmp.height;

  const longEdge = Math.max(w, h);
  const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;

  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.drawImage(bmp, 0, 0, outW, outH);

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", QUALITY)
  );

  if (!blob) return file;

  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

function makeInitialChipsFromVision(v: any, userText: string): Chip[] {
  // Works with the schema we asked for; if some fields missing, skip them.
  const category = cleanToken(v?.category || v?.itemType);
  const brand = cleanToken(v?.brand);
  const model = cleanToken(v?.model);
  const color = cleanToken(v?.color);
  const material = cleanToken(v?.material);
  const pattern = cleanToken(v?.pattern);
  const hardwareColor = cleanToken(v?.hardwareColor);
  const approxSize = cleanToken(v?.approxSize);

  const cuesRaw: string[] = Array.isArray(v?.keyVisualCues) ? v.keyVisualCues : [];
  const cues = cuesRaw.map(cleanToken).filter(Boolean);

  const base: Array<{ kind: string; text: string; on?: boolean }> = [];
  if (category) base.push({ kind: "category", text: category, on: true });
  if (brand) base.push({ kind: "brand", text: brand, on: true });
  if (model) base.push({ kind: "model", text: model, on: false }); // default OFF (avoid over-filtering)
  if (color) base.push({ kind: "color", text: color, on: true });
  if (material) base.push({ kind: "material", text: material, on: true });
  if (pattern) base.push({ kind: "pattern", text: pattern, on: false }); // often noisy
  if (hardwareColor) base.push({ kind: "hardwareColor", text: hardwareColor, on: false });
  if (approxSize) base.push({ kind: "approxSize", text: approxSize, on: false });

  // Add a couple cues (default OFF, user can enable)
  for (const c of cues.slice(0, 6)) {
    base.push({ kind: "cue", text: c, on: false });
  }

  // If brand is missing, use user text tokens as fallback (high recall)
  const fallbackWords = uniq(
    normalizeSpaces(userText)
      .split(" ")
      .map(cleanToken)
      .filter((w) => w.length >= 3)
  ).slice(0, 6);

  if (!brand && fallbackWords.length) {
    for (const w of fallbackWords) base.push({ kind: "fallback", text: w, on: true });
  }

  // Ensure there’s always something to search
  if (base.length === 0) {
    base.push({ kind: "fallback", text: "designer", on: true });
    base.push({ kind: "fallback", text: "bag", on: true });
  }

  return base.map((x, i) => ({
    id: `${x.kind}-${i}-${x.text}`,
    kind: x.kind,
    text: x.text,
    on: x.on ?? true,
  }));
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set, get) => ({
      lang: "en",
      text: "",
      imageFile: null,

      loading: false,
      err: null,
      vision: null,
      chips: [],
      strategy: "broad",

      queryOverride: "",
      queryDirty: false,

      setLang: (lang) => set({ lang }),
      setText: (text) => set({ text }),
      setImageFile: (imageFile) => set({ imageFile }),
      setStrategy: (strategy) => set({ strategy }),
      toggleChip: (id) =>
        set((s) => ({ chips: s.chips.map((c) => (c.id === id ? { ...c, on: !c.on } : c)) })),
      deleteChip: (id) => set((s) => ({ chips: s.chips.filter((c) => c.id !== id) })),
      resetOutputs: () =>
        set({
          err: null,
          vision: null,
          chips: [],
          strategy: "broad",
          loading: false,
          queryOverride: "",
          queryDirty: false,
        }),

      setQueryOverride: (q) => set({ queryOverride: q, queryDirty: true }),
      clearQueryOverride: () => set({ queryOverride: "", queryDirty: false }),

      activeQuery: () => {
        const { chips, strategy, vision, queryOverride, queryDirty } = get();
        const auto = buildQuery({ kind: strategy, chips, vision });
        return queryDirty ? queryOverride : auto;
      },

      generate: async () => {
        const { imageFile, text } = get();

        const startedAt = Date.now();
        set({ err: null, loading: true });
        try {
          // If no image, we still create chips from text (high recall)
          if (!imageFile) {
            const words = uniq(
              normalizeSpaces(text)
                .split(" ")
                .map(cleanToken)
                .filter((w) => w.length >= 3)
            ).slice(0, 8);

            const base: Chip[] =
              words.length > 0
                ? words.map((w, i) => ({ id: `word-${i}-${w}`, text: w, on: true, kind: "fallback" }))
                : [
                    { id: "fallback-0-designer", text: "designer", on: true, kind: "fallback" },
                    { id: "fallback-1-bag", text: "bag", on: true, kind: "fallback" },
                  ];

            set({ vision: null, chips: base, strategy: "broad", queryOverride: "", queryDirty: false });
            return;
          }

          const form = new FormData();
          const uploadFile = await downscaleImage(imageFile);
          form.append("image", uploadFile);
          form.append("text", normalizeSpaces(text));

          const res = await fetch("/api/vision", { method: "POST", body: form });
          const data = await res.json();

          if (!res.ok) {
            throw new Error(data?.error || "Vision request failed");
          }

          set({
            vision: data,
            chips: makeInitialChipsFromVision(data, text),
            strategy: "broad",
            queryOverride: "",
            queryDirty: false,
          });
        } catch (e: any) {
          set({ err: e?.message || "Generate failed" });
        } finally {
          // Ensure the loading indicator is visible (avoid flicker on fast responses).
          const MIN_LOADING_MS = 450;
          const elapsed = Date.now() - startedAt;
          const remain = MIN_LOADING_MS - elapsed;
          if (remain > 0) {
            await new Promise((r) => setTimeout(r, remain));
          }
          set({ loading: false });
        }
      },
    }),
    {
      name: "prelovefinder-search-v1",
      partialize: (s) => ({
        lang: s.lang,
        text: s.text,
        vision: s.vision,
        chips: s.chips,
        strategy: s.strategy,
        queryOverride: s.queryOverride,
        queryDirty: s.queryDirty,
      }),
    }
  )
);
