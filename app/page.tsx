"use client";

import { useMemo, useState } from "react";

type Lang = "en" | "zh";
type Strategy = "broad" | "exact" | "strict" | "chips";
type Platform = "ebay" | "vinted" | "depop" | "vestiaire" | "etsy";

const TEXT: Record<Lang, Record<string, string>> = {
  en: {
    title: "Resale Bag Search Helper (Demo)",
    subtitle:
      "Goal: reduce cross-platform search & decision time. We don’t scrape listings; we generate better search intents + 1-tap platform searches.",
    placeholder: "Describe the bag (optional), e.g. coach bag with C buckle",
    upload: "Upload image (recommended)",
    gen: "Generate keywords",
    detected: "Detected keywords (edit if needed)",
    strategy: "Query mode",
    s1: "Broad (best default)",
    s2: "Exact (if confident)",
    s3: "Strict (authentic only)",
    open: "Open on",
    next: "Next steps on platform:",
    hint1: "Filter → Category: Bags/Handbags",
    hint2: "Filter → Brand (if available)",
    hint3: 'Exclude terms: "replica", "dupe", "inspired"',
    copyQuery: "Copy query",
    query: "Query",
    needImage: "Tip: upload a clearer photo (front view / logo / buckle) for better results.",
  },
  zh: {
    title: "二手包跨平台搜索助手（Demo）",
    subtitle:
      "目标：减少跨平台搜索与决策时间。不抓取商品数据，只做关键词意图生成 + 一键跳转搜索。",
    placeholder: "（可选）描述一下包，例如：coach 带 C 扣的包",
    upload: "上传图片（推荐）",
    gen: "生成关键词",
    detected: "识别关键词（可点选/删除）",
    strategy: "关键词模式",
    s1: "Broad（默认）",
    s2: "Exact（更精确）",
    s3: "Strict（严格正品）",
    open: "打开",
    next: "到平台后下一步：",
    hint1: "筛选 → 类目：Bags/Handbags",
    hint2: "筛选 → 品牌（如果有）",
    hint3: "排除词：replica / dupe / inspired",
    copyQuery: "复制关键词",
    query: "关键词",
    needImage: "提示：上传更清晰的正面/Logo/扣子图，识别会更准。",
  },
};

function normalizeSpaces(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function cleanToken(s: string) {
  return normalizeSpaces(String(s || ""))
    .replace(/[^\p{L}\p{N}\s\-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Build platform URLs without scraping
function ebayCategoryIdFromVision(v: any): string | null {
  const cat = String(v?.category || "").toLowerCase();
  const itemType = String(v?.itemType || "").toLowerCase();

  // Best-effort eBay category ids (works reasonably well for UK too).
  // If you want to be precise per-country, we can refine later.
  // Women\'s Handbags & Bags
  if (itemType === "bag" || cat.includes("bag") || cat.includes("handbag") || cat.includes("tote") || cat.includes("shoulder") || cat.includes("crossbody")) {
    return "169291";
  }

  return null;
}

function platformUrl(p: Platform, query: string, vision?: any) {
  const q = encodeURIComponent(query);

  if (p === "ebay") {
    const base = `https://www.ebay.co.uk/sch/i.html?_nkw=${q}`;

    const params: string[] = [];
    // Add a category filter when we can (big speedup vs free-text only)
    const sacat = ebayCategoryIdFromVision(vision);
    if (sacat) params.push(`_sacat=${sacat}`);

    // Slightly nicer defaults for testing
    params.push(`_ipg=60`); // items per page
    params.push(`LH_PrefLoc=1`); // prefer local (UK)

    return params.length ? `${base}&${params.join("&")}` : base;
  }

  if (p === "vinted") return `https://www.vinted.co.uk/catalog?search_text=${q}`;
  if (p === "depop") return `https://www.depop.com/search/?q=${q}`;
  if (p === "vestiaire") return `https://www.vestiairecollective.com/search/?q=${q}`;
  if (p === "etsy") return `https://www.etsy.com/uk/search?q=${q}`;
  return "#";
}

function logoFor(p: Platform) {
  return `/logos/${p}.png`;
}

type Chip = { id: string; text: string; on: boolean; kind?: string };

export default function Page() {
  const [lang, setLang] = useState<Lang>("en");
  const t = TEXT[lang];

  const [text, setText] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // raw vision output (we keep it to build better queries + show confidence later if needed)
  const [vision, setVision] = useState<any>(null);

  const [chips, setChips] = useState<Chip[]>([]);
  const [strategy, setStrategy] = useState<Strategy>("broad");

  const platforms: { key: Platform; name: string }[] = [
    { key: "ebay", name: "eBay" },
    { key: "vinted", name: "Vinted" },
    { key: "depop", name: "Depop" },
    { key: "vestiaire", name: "Vestiaire" },
    { key: "etsy", name: "Etsy" },
  ];

  function toggleChip(id: string) {
    setChips((prev) => prev.map((c) => (c.id === id ? { ...c, on: !c.on } : c)));
  }

  function deleteChip(id: string) {
    setChips((prev) => prev.filter((c) => c.id !== id));
  }

  function buildQuery(kind: Strategy) {
    // Preferred: use model-generated suggested queries from vision (ensemble output)
    const sq = vision?.suggestedQueries;
    if (sq && typeof sq === "object") {
      const direct = kind !== "chips" ? sq[kind] : null;
      if (typeof direct === "string" && direct.trim()) return normalizeSpaces(direct);
    }

    // Fallback: build from chips
    const on = chips.filter((c) => c.on).map((c) => c.text);
    const get = (k: string) => chips.find((c) => c.kind === k)?.text;

    const category = get("category") || get("itemType") || get("categoryHint") || "item";
    const brand = get("brand");
    const model = get("model");
    const color = get("color");
    const material = get("material");
    const pattern = get("pattern");

    if (kind === "exact" && brand && model) {
      return normalizeSpaces([brand, model, category, color, material, pattern].filter(Boolean).join(" "));
    }

    if (kind === "strict") {
      return normalizeSpaces([
        brand,
        model,
        category,
        color,
        material,
        pattern,
        "authentic genuine",
      ]
        .filter(Boolean)
        .join(" "));
    }

    // broad / chips
    return (
      normalizeSpaces([brand, category, color, material].filter(Boolean).join(" ")) ||
      normalizeSpaces(on.join(" "))
    );
  }

  const activeQuery = useMemo(() => {
    return buildQuery(strategy);
  }, [chips, strategy, vision]);

  async function copyToClipboard(s: string) {
    try {
      await navigator.clipboard.writeText(s);
    } catch {
      // ignore
    }
  }

  function makeInitialChipsFromVision(v: any): Chip[] {
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
      normalizeSpaces(text)
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

  async function onGenerate() {
    setErr(null);
    setLoading(true);

    try {
      if (!imageFile) {
        // If no image, we still create chips from text (high recall)
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

        setVision(null);
        setChips(base);
        setStrategy("broad");
        return;
      }

      const form = new FormData();
      form.append("image", imageFile);
      form.append("text", normalizeSpaces(text));

      const res = await fetch("/api/vision", { method: "POST", body: form });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Vision request failed");
      }

      // For debugging if needed:
      // console.log("VISION_JSON", data);

      setVision(data);
      setChips(makeInitialChipsFromVision(data));

      // Default: broad query
      setStrategy("broad");
    } catch (e: any) {
      setErr(e?.message || "Generate failed");
    } finally {
      setLoading(false);
    }
  }

  // showModelStrategy removed (query modes now come from suggestedQueries)

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 16, fontFamily: "system-ui" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: "8px 0" }}>{t.title}</h1>
        <button
          onClick={() => setLang((x) => (x === "en" ? "zh" : "en"))}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "#fff",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          {lang === "en" ? "中文" : "EN"}
        </button>
      </div>

      <p style={{ marginTop: 0, color: "#555", lineHeight: 1.4 }}>{t.subtitle}</p>

      {/* Input */}
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.placeholder}
          style={{
            padding: "12px 12px",
            border: "1px solid #ddd",
            borderRadius: 12,
            fontSize: 16,
          }}
        />

        <label style={{ fontSize: 13, color: "#444" }}>
          {t.upload}
          <input
            type="file"
            accept="image/*"
            style={{ display: "block", marginTop: 6 }}
            onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
          />
        </label>

        <button
          onClick={onGenerate}
          disabled={loading}
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid #111",
            background: loading ? "#333" : "#111",
            color: "#fff",
            fontWeight: 900,
          }}
        >
          {loading ? "…" : t.gen}
        </button>

        <div style={{ fontSize: 12, color: "#777" }}>{t.needImage}</div>

        {err && (
          <div style={{ padding: 12, borderRadius: 12, border: "1px solid #f5c2c7", background: "#f8d7da" }}>
            {err}
          </div>
        )}
      </div>

      {/* Detected keywords */}
      {chips.length > 0 && (
        <section style={{ marginTop: 16, padding: 12, border: "1px solid #eee", borderRadius: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 900 }}>{t.detected}</div>
            <div style={{ fontSize: 12, color: "#666" }}>
              {vision?.confidence ? `confidence: ${vision.confidence}` : ""}
            </div>
          </div>

          {/* Iconic model (debug/product validation) */}
          {vision?.iconicModel?.label && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#333", lineHeight: 1.4 }}>
              <div style={{ fontWeight: 900 }}>Iconic model</div>
              <div>
                {vision.iconicModel.label}
                {vision.iconicModel.score ? ` (score ${vision.iconicModel.score})` : ""}
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {chips.map((c) => (
              <div
                key={c.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  borderRadius: 999,
                  border: c.on ? "1px solid #111" : "1px solid #ddd",
                  background: c.on ? "#111" : "#fff",
                  color: c.on ? "#fff" : "#111",
                  padding: "6px 10px",
                  fontSize: 13,
                  fontWeight: 800,
                }}
              >
                <button
                  onClick={() => toggleChip(c.id)}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                  }}
                  title="toggle"
                >
                  {c.text}
                </button>

                <button
                  onClick={() => deleteChip(c.id)}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    opacity: 0.8,
                    fontWeight: 900,
                  }}
                  title="delete"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {/* Strategy */}
          <div style={{ marginTop: 14, fontWeight: 900 }}>{t.strategy}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button
              onClick={() => setStrategy("broad")}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: strategy === "broad" ? "1px solid #111" : "1px solid #ddd",
                background: strategy === "broad" ? "#111" : "#fff",
                color: strategy === "broad" ? "#fff" : "#111",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              {t.s1}
            </button>

            <button
              onClick={() => setStrategy("exact")}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: strategy === "exact" ? "1px solid #111" : "1px solid #ddd",
                background: strategy === "exact" ? "#111" : "#fff",
                color: strategy === "exact" ? "#fff" : "#111",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              {t.s2}
            </button>

            <button
              onClick={() => setStrategy("strict")}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: strategy === "strict" ? "1px solid #111" : "1px solid #ddd",
                background: strategy === "strict" ? "#111" : "#fff",
                color: strategy === "strict" ? "#fff" : "#111",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              {t.s3}
            </button>

            <button
              onClick={() => setStrategy("chips")}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: strategy === "chips" ? "1px solid #111" : "1px solid #ddd",
                background: strategy === "chips" ? "#111" : "#fff",
                color: strategy === "chips" ? "#fff" : "#111",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Chips
            </button>
          </div>

          {/* Active query */}
          <div style={{ marginTop: 12, fontSize: 12, color: "#666" }}>{t.query}</div>
          <div style={{ marginTop: 6, fontSize: 14, fontWeight: 900 }}>{activeQuery}</div>
          <button
            onClick={() => copyToClipboard(activeQuery)}
            style={{
              marginTop: 10,
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "#fff",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            {t.copyQuery}
          </button>

          <div style={{ marginTop: 10, fontSize: 12, color: "#666", lineHeight: 1.5 }}>
            {t.next} {t.hint1} · {t.hint2} · {t.hint3}
          </div>
        </section>
      )}

      {/* Platforms */}
      {chips.length > 0 && (
        <section style={{ marginTop: 14, display: "grid", gap: 12 }}>
          {platforms.map((p) => {
            const url = platformUrl(p.key, activeQuery, vision);
            return (
              <a
                key={p.key}
                href={url}
                rel="noreferrer"
                style={{
                  display: "grid",
                  gridTemplateColumns: "64px 1fr",
                  gap: 12,
                  padding: 12,
                  border: "1px solid #eee",
                  borderRadius: 14,
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 12,
                    overflow: "hidden",
                    background: "#f3f3f3",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logoFor(p.key)}
                    alt={p.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </div>

                <div>
                  <div style={{ fontSize: 16, fontWeight: 950 }}>
                    {t.open} {p.name} →
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
                    {t.next} {t.hint1} · {t.hint2}
                  </div>
                </div>
              </a>
            );
          })}
        </section>
      )}
    </main>
  );
}