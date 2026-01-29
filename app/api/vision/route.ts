import OpenAI from "openai";
import { NextResponse } from "next/server";
import { Buffer } from "buffer";
import crypto from "crypto";

export const runtime = "nodejs";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Simple in-memory cache (dev-friendly) ---
// Keyed by sha256(imageBytes)+hint, to avoid re-paying while iterating.
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { ts: number; value: any }>();

function sha256(buf: Buffer) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function now() {
  return Date.now();
}

function pickFirstNonEmpty(...vals: Array<string | null | undefined>) {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function uniqStrings(xs: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      xs
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter((s) => s.length > 0)
    )
  );
}

function normalizeQuery(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function safeJsonParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function callVisionJSON(args: {
  dataUrl: string;
  prompt: string;
  model?: string;
}) {
  const model = args.model ?? "gpt-4.1-mini";
  const resp = await client.responses.create({
    model,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: args.prompt },
          { type: "input_image", image_url: args.dataUrl },
        ],
      },
    ] as any,
  });

  const out = resp.output_text?.trim() || "";
  const json = safeJsonParse(out);
  if (!json) throw new Error(`Non-JSON output from model (${model})`);
  return json;
}

async function callTextJSON(args: { prompt: string; model?: string }) {
  const model = args.model ?? "gpt-4.1-mini";
  const resp = await client.responses.create({
    model,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: args.prompt }],
      },
    ] as any,
  });

  const out = resp.output_text?.trim() || "";
  const json = safeJsonParse(out);
  if (!json) throw new Error(`Non-JSON output from model (${model})`);
  return json;
}

/**
 * Ensemble strategy (3-pass):
 * A) Attribute extractor: conservative, "facts only".
 * B) Query generator: produce broad/exact/strict + keywords.
 * C) OCR-ish: extract visible text strings.
 */
function buildPromptA(userHint: string) {
  return `
You are a careful product identifier for second-hand search. The input is an IMAGE of a single primary fashion item.
Goal: extract ONLY what is clearly visible. If unsure, use null/"unknown".
Return ONLY JSON matching the schema below.

Schema:
{
  "itemType": "bag"|"shoes"|"clothing"|"accessory"|"jewelry"|"watch"|"other",
  "category": string, // short human label, e.g. "sneakers", "hoodie", "tote bag", "leather jacket". Use "unknown" if unclear.
  "brand": string|null,
  "model": string|null,
  "color": string|null,
  "material": string|null,
  "pattern": string|null,
  "keyVisualCues": string[],
  "confidence": "high"|"medium"|"low",
  "notes": string|null
}

Rules:
- Prefer NOT to hallucinate brand or model.
- If the brand name/logo text is clearly visible, set brand.
- If the brand is not text-visible but the item has a very distinctive, widely-known monogram/logo pattern (e.g. LV monogram, Dior oblique, Gucci GG, Chanel quilting + CC lock), you MAY set brand as a best-effort guess BUT then:
  - set confidence="medium" or "low" (never "high")
  - explain in notes that it was inferred from monogram/logo cues.
- If no strong signal: brand=null and confidence="low".
- If multiple items are present: focus on the most central / primary item.
- Keep keyVisualCues short (2-6 items), like "monogram canvas", "chunky sole", "double G buckle", "quilted", "logo patch".
- Optional user hint text: ${userHint ? JSON.stringify(userHint) : "(none)"}.
`.trim();
}

function buildPromptBFromFacts(args: { userHint: string; facts: any }) {
  const { userHint, facts } = args;
  return `
You generate search-friendly queries for second-hand marketplaces.
You will be given STRUCTURED FACTS extracted from an image. Use ONLY those facts.
Return ONLY JSON matching the schema below.

Schema:
{
  "keywords": string[],
  "suggestedQueries": {
    "broad": string,
    "exact": string,
    "strict": string
  },
  "assumptions": string[]
}

FACTS (do not add new facts):
${JSON.stringify(facts, null, 2)}

Rules:
- Queries must be short and optimized for marketplace search.
- broad: maximize recall; include brand (if present or confidently implied by visibleText), plus category + (color/material) when present; avoid uncertain model names.
- exact: include model ONLY if confidence is high and model is present.
- strict: add "authentic genuine".
- Avoid: replica, dupe, inspired, style, lookalike.
- Prefer lowercase, spaces, no punctuation.
- If color is multi/various, use "multicolor".
- Optional user hint text: ${userHint ? JSON.stringify(userHint) : "(none)"}.
`.trim();
}

function buildPromptC() {
  return `
Extract any VISIBLE TEXT from the image that could help searching (brand names, model names, labels).
Return ONLY JSON:
{
  "visibleText": string[],
  "bestBrandGuess": string|null
}

Rules:
- If no text is visible: visibleText=[] and bestBrandGuess=null.
- You may set bestBrandGuess if there is a strong, recognizable brand signal from visible logo text OR iconic monogram/logo pattern.
- If uncertain: bestBrandGuess=null.
`.trim();
}

function mergeEnsemble(a: any, b: any, c: any) {
  const itemType = (typeof a?.itemType === "string" && a.itemType) || "other";
  const category = (typeof a?.category === "string" && a.category) || "unknown";

  // Brand: prefer A.brand if present; else C.bestBrandGuess.
  // If both present but disagree, keep A.brand (more constrained) and lower confidence.
  let brand = pickFirstNonEmpty(a?.brand, c?.bestBrandGuess);

  const model = typeof a?.model === "string" ? a.model : null;
  const color = typeof a?.color === "string" ? a.color : null;
  const material = typeof a?.material === "string" ? a.material : null;
  const pattern = typeof a?.pattern === "string" ? a.pattern : null;

  const cues = Array.isArray(a?.keyVisualCues) ? a.keyVisualCues : [];
  const ocrTokens = Array.isArray(c?.visibleText) ? c.visibleText : [];
  const keywordsFromB = Array.isArray(b?.keywords) ? b.keywords : [];

  const keywords = uniqStrings([
    brand ?? undefined,
    model ?? undefined,
    category && category !== "unknown" ? category : undefined,
    color ?? undefined,
    material ?? undefined,
    pattern ?? undefined,
    ...cues,
    ...ocrTokens,
    ...keywordsFromB,
  ]).slice(0, 30);

  // Suggested queries:
  const sq = b?.suggestedQueries || {};
  const broad = typeof sq?.broad === "string" ? sq.broad : "";
  const exact = typeof sq?.exact === "string" ? sq.exact : "";
  const strict = typeof sq?.strict === "string" ? sq.strict : "";

  const fallbackBroad = normalizeQuery(
    [brand, category !== "unknown" ? category : null, color, material].filter(Boolean).join(" ")
  );
  const fallbackExact = normalizeQuery(
    [brand, model, category !== "unknown" ? category : null, color, material, pattern].filter(Boolean).join(" ")
  );
  const fallbackStrict = normalizeQuery(
    [fallbackExact || fallbackBroad, "authentic genuine"].filter(Boolean).join(" ")
  );

  // Confidence
  let confidence: "high" | "medium" | "low" = "low";
  if (typeof a?.confidence === "string" && ["high", "medium", "low"].includes(a.confidence)) {
    confidence = a.confidence;
  }

  // If brand disagreement, downgrade
  if (a?.brand && c?.bestBrandGuess && String(a.brand).trim() && String(c.bestBrandGuess).trim()) {
    if (String(a.brand).trim().toLowerCase() !== String(c.bestBrandGuess).trim().toLowerCase()) {
      confidence = "low";
    }
  }

  return {
    itemType,
    category,
    brand: brand || null,
    model,
    color,
    material,
    pattern,
    keyVisualCues: Array.isArray(cues) ? cues : [],
    confidence,
    keywords,
    suggestedQueries: {
      broad: normalizeQuery(broad || fallbackBroad || keywords.slice(0, 6).join(" ")),
      exact: normalizeQuery(exact || fallbackExact || fallbackBroad || keywords.slice(0, 8).join(" ")),
      strict: normalizeQuery(strict || fallbackStrict || (fallbackBroad ? `${fallbackBroad} authentic genuine` : "authentic genuine")),
    },
    _debug: {
      a,
      b,
      c,
    },
  };
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const form = await req.formData();
    const file = form.get("image");
    const userText = String(form.get("text") || "").trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No image uploaded" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    const mime = file.type || "image/jpeg";
    const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;

    const key = `${sha256(bytes)}:${userText}`;
    const cached = cache.get(key);
    if (cached && now() - cached.ts < CACHE_TTL_MS) {
      return NextResponse.json({ ...cached.value, _cached: true });
    }

    // Run A + C first (both look at the image)
    const [a, c] = await Promise.all([
      callVisionJSON({ dataUrl, prompt: buildPromptA(userText) }),
      callVisionJSON({ dataUrl, prompt: buildPromptC() }),
    ]);

    // Derive facts for query generation (B)
    const facts = {
      itemType: (typeof a?.itemType === "string" && a.itemType) || "other",
      category: (typeof a?.category === "string" && a.category) || "unknown",
      brand: pickFirstNonEmpty(a?.brand, c?.bestBrandGuess),
      model: typeof a?.model === "string" ? a.model : null,
      color: typeof a?.color === "string" ? a.color : null,
      material: typeof a?.material === "string" ? a.material : null,
      pattern: typeof a?.pattern === "string" ? a.pattern : null,
      keyVisualCues: Array.isArray(a?.keyVisualCues) ? a.keyVisualCues : [],
      visibleText: Array.isArray(c?.visibleText) ? c.visibleText : [],
      confidence: a?.confidence,
    };

    // B uses only facts (this is what improves color/material/silhouette inclusion in queries)
    const b = await callTextJSON({ prompt: buildPromptBFromFacts({ userHint: userText, facts }) });

    const merged = mergeEnsemble(a, b, c);
    cache.set(key, { ts: now(), value: merged });

    return NextResponse.json(merged);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Vision error" }, { status: 500 });
  }
}
