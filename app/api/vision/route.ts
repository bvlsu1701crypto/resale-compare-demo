import OpenAI from "openai";
import { NextResponse } from "next/server";
import { Buffer } from "buffer";
import crypto from "crypto";
import { detectIconicModels } from "@/app/lib/iconicModels";
import { ICONIC_BAGS_TOP20 } from "@/app/lib/iconicCatalog";

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

function normalizeColor(raw: any): string | null {
  const s = String(raw || "").toLowerCase().trim();
  if (!s) return null;
  // Coarse normalization for resale platforms
  if (/(multi|rainbow|stripe|various|colorful)/.test(s)) return "multicolor";
  if (/(cream|ivory|off[- ]?white|ecru|light beige|beige)/.test(s)) return "beige";
  if (/(white)/.test(s)) return "white";
  if (/(black)/.test(s)) return "black";
  if (/(brown|tan|camel)/.test(s)) return "brown";
  if (/(red|burgundy|maroon)/.test(s)) return "red";
  if (/(blue|navy)/.test(s)) return "blue";
  if (/(green)/.test(s)) return "green";
  if (/(grey|gray|silver)/.test(s)) return "grey";
  if (/(pink)/.test(s)) return "pink";
  return s;
}

const BRAND_ALLOWLIST = new Set([
  "dior",
  "christian dior",
  "chanel",
  "gucci",
  "louis vuitton",
  "prada",
  "balenciaga",
  "loewe",
  "valentino",
  "maison margiela",
  "mm6",
  "mm6 maison margiela",
  "comme des garcons",
  "alexander mcqueen",
  "adidas",
  "onitsuka tiger",
  "chloe",
]);

// Brands we only accept when the brand text is actually visible (to prevent "looks like" confusion)
const BRAND_REQUIRE_VISIBLE_TEXT = new Set([
  "loewe",
  "chloe",
  // Note: mcqueen can be inferred from iconic skull hardware; margiela/mm6 from four stitches/numbers label
  "valentino",
  "prada",
]);

// Brands that can be inferred from iconic monogram/pattern/logo cues (without explicit text)
const BRAND_ICONIC_PATTERN: Record<string, RegExp> = {
  // LV: do NOT infer from generic "monogram" alone (too many brands have monograms).
  // Require LV-specific signals.
  "louis vuitton": /(\blv\b|louis vuitton|damier|monogram\s*lv|lv\s*monogram)/,

  // Gucci: prefer explicit GG / horsebit / web stripe; avoid generic monogram.
  "gucci": /(\bgg\b|web stripe|green red green|horsebit|double g|interlocking g)/,

  // Dior: prefer oblique (avoid generic monogram)
  "dior": /(oblique|dior oblique|dior monogram|christian dior)/,

  "chanel": /(\bcc\b|quilt|quilted|diamond quilt|mademoiselle|turnlock)/,

  // adidas: three stripes / trefoil
  "adidas": /(three stripes|3 stripes|trefoil)/,

  // onitsuka tiger: tiger stripes (side stripes)
  "onitsuka tiger": /(tiger stripes|tiger stripe|side stripes)/,

  // alexander mcqueen: skull hardware / skull embellishment cues
  "alexander mcqueen": /(skull|skull buckle|skull heel|skull embellishment)/,

  // balenciaga: city/motorcycle bag cues
  "balenciaga": /(city bag|motorcycle bag|giant studs|whipstitch|braided handles|front zip pocket|tassels)/,

  // maison margiela: four stitches / numbers label / tabi
  "maison margiela": /(four stitches|four stitch|numbers label|numeric label|tabi|margiela)/,
  "mm6": /(mm6|margiela)/,
  "mm6 maison margiela": /(mm6|margiela)/,
};

function visibleHasBrand(visibleText: string, brand: string) {
  const v = visibleText.toLowerCase();
  const b = brand.toLowerCase();
  if (!v || !b) return false;
  if (b === "louis vuitton") return v.includes("louis") || v.includes("vuitton") || v.includes("lv");
  return v.includes(b);
}

function isBrandAllowedWithEvidence(opts: { brand: string; visibleText: string; signals: string }) {
  const brand = opts.brand;
  if (!BRAND_ALLOWLIST.has(brand)) return false;

  // If brand requires visible text, enforce it
  if (BRAND_REQUIRE_VISIBLE_TEXT.has(brand)) {
    return visibleHasBrand(opts.visibleText, brand);
  }

  // Otherwise allow if visible text contains it OR iconic pattern matches
  if (visibleHasBrand(opts.visibleText, brand)) return true;
  const re = BRAND_ICONIC_PATTERN[brand];
  if (re && re.test(opts.signals)) return true;

  // Default: require visible text
  return false;
}

function normalizeBrand(raw: any): string | null {
  const s = String(raw || "").toLowerCase().trim();
  if (!s) return null;
  // normalize common variants
  const v = s
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (v === "lv") return "louis vuitton";
  if (v === "christian dior") return "christian dior";
  if (v === "dior") return "dior";
  if (v === "mm6") return "mm6";
  if (v === "mm6 maison margiela") return "mm6 maison margiela";
  if (v === "maison margiela") return "maison margiela";
  if (v === "comme des garcons") return "comme des garcons";
  return v;
}

function acceptBrand(raw: any, evidence?: { visibleText?: string; signals?: string }): string | null {
  const b = normalizeBrand(raw);
  if (!b) return null;

  const visibleText = String(evidence?.visibleText || "").toLowerCase();
  const signals = String(evidence?.signals || "").toLowerCase();

  // Only accept from allowlist AND with evidence to avoid OCR hallucinations like "SPACKHAMER"/"BACKCHANNEL"
  if (!isBrandAllowedWithEvidence({ brand: b, visibleText, signals })) return null;
  return b;
}

function normalizeFactsForQuery(facts: any) {
  const color = normalizeColor(facts?.color);
  // If cues strongly indicate multicolor, prefer multicolor
  const cues = Array.isArray(facts?.keyVisualCues) ? facts.keyVisualCues.join(" ").toLowerCase() : "";
  const pattern = String(facts?.pattern || "").toLowerCase();
  const visibleText = Array.isArray(facts?.visibleText) ? facts.visibleText.join(" ").toLowerCase() : "";

  const combinedSignals = `${visibleText} ${pattern} ${cues}`;

  let brand = acceptBrand(facts?.brand, { visibleText, signals: combinedSignals });

  // If brand is missing, try a best-effort guess from strong visible signals
  if (!brand && combinedSignals) {
    // lightweight: if signals contain well-known brand tokens, keep the first match
    const candidates = [
      "christian dior",
      "dior",
      "chanel",
      "gucci",
      "louis vuitton",
      "lv",
      "prada",
      "balenciaga",
      "loewe",
      "valentino",
      "maison margiela",
      "margiela",
      "comme des garcons",
      "adidas",
    ];
    for (const c of candidates) {
      if (combinedSignals.includes(c)) {
        brand = acceptBrand(c === "lv" ? "louis vuitton" : c, { visibleText, signals: combinedSignals });
        break;
      }
    }
  }

  // Demo-only heuristic: some monogram + multicolor stripe style often indicates Dior.
  // Keep confidence controlled elsewhere; this is only to improve search usefulness.
  if (!brand && /monogram/.test(pattern) && /multi|rainbow|stripe/.test(`${pattern} ${cues}`)) {
    brand = acceptBrand("dior", { visibleText, signals: combinedSignals });
  }

  return {
    ...facts,
    brand,
    color: /multi|rainbow|stripe|various|colorful/.test(`${cues} ${pattern}`) ? "multicolor" : color,
  };
}

function safeJsonParse(s: string) {
  const raw = String(s || "").trim();
  if (!raw) return null;

  // Common failure mode: model wraps JSON in ```json fences
  const unfenced = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch {
    // Best-effort: extract the first top-level JSON object/array substring
    const firstObj = unfenced.indexOf("{");
    const firstArr = unfenced.indexOf("[");
    let start = -1;
    if (firstObj !== -1 && firstArr !== -1) start = Math.min(firstObj, firstArr);
    else start = firstObj !== -1 ? firstObj : firstArr;

    if (start === -1) return null;

    const endObj = unfenced.lastIndexOf("}");
    const endArr = unfenced.lastIndexOf("]");
    let end = -1;
    if (endObj !== -1 && endArr !== -1) end = Math.max(endObj, endArr);
    else end = endObj !== -1 ? endObj : endArr;

    if (end === -1 || end <= start) return null;

    const slice = unfenced.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch {
      return null;
    }
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

function ensureToken(query: string, token: string | null) {
  const q = normalizeQuery(String(query || "").toLowerCase());
  const t = normalizeQuery(String(token || "").toLowerCase());
  if (!t) return q;
  if (q.includes(t)) return q;
  return normalizeQuery(`${q} ${t}`);
}

function stripSuspiciousBrandTokens(q: string) {
  // Remove hallucinated brand-ish tokens/phrases while keeping normal descriptors.
  let s = normalizeQuery(String(q || "").toLowerCase());

  // Drop known garbage tokens/phrases we saw in eval
  s = s.replace(/\b(backchannel|spackhamer|lexileee|bvlcantea)\b/g, "");
  s = s.replace(/\bphilippe\s+model\b/g, "");

  const SAFE = new Set([
    // common descriptors
    "black",
    "white",
    "beige",
    "brown",
    "red",
    "blue",
    "green",
    "grey",
    "pink",
    "multicolor",
    "leather",
    "patent",
    "canvas",
    "denim",
    "nylon",
    "suede",
    "cotton",
    "silk",
    "wool",
    "dress",
    "skirt",
    "top",
    "hoodie",
    "jacket",
    "coat",
    "sneakers",
    "shoes",
    "pumps",
    "heels",
    "boots",
    "booties",
    "ankle",
    "bag",
    "handbag",
    "tote",
    "tote bag",
    "shoulder",
    "shoulder bag",
    "crossbody",
    "crossbody bag",
    "hobo",
    "hobo bag",
    "top",
    "handle",
    "top handle",
    "top handle bag",
    "boston",
    "boston bag",
    "monogram",
    "quilted",
    "quilt",
    "authentic",
    "genuine",
  ]);

  const tokens = s.split(/\s+/).filter(Boolean);
  const cleaned: string[] = [];

  for (const t of tokens) {
    const cand = normalizeBrand(t);
    if (cand && BRAND_ALLOWLIST.has(cand)) {
      cleaned.push(t);
      continue;
    }

    if (SAFE.has(t)) {
      cleaned.push(t);
      continue;
    }

    // Drop long weird tokens that are likely OCR/brand hallucinations
    if (t.length >= 9 && /^[a-z]+$/.test(t) && !/[aeiou]/.test(t)) continue;

    cleaned.push(t);
  }

  return normalizeQuery(cleaned.join(" "));
}

function removeOtherBrands(q: string, keepBrand: string | null) {
  let s = normalizeQuery(String(q || "").toLowerCase());
  const keep = keepBrand ? normalizeBrand(keepBrand) : null;

  // Remove any allowlisted brand tokens/phrases that are NOT the facts brand.
  // This prevents "bottega veneta" sneaking into a McQueen shoe query.
  const phrases = Array.from(BRAND_ALLOWLIST);
  // Sort longer phrases first (e.g. "louis vuitton")
  phrases.sort((a, b) => b.length - a.length);

  for (const br of phrases) {
    if (keep && br === keep) continue;
    // remove whole-word occurrences of the brand phrase
    const escaped = br.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "g");
    s = s.replace(re, "");
  }

  return normalizeQuery(s);
}

function postprocessQueries(facts: any, b: any) {
  const sq = b?.suggestedQueries || {};
  let broad = typeof sq.broad === "string" ? sq.broad : "";
  let exact = typeof sq.exact === "string" ? sq.exact : broad;
  let strict = typeof sq.strict === "string" ? sq.strict : "";

  const brand = facts?.brand ? String(facts.brand) : null;

  // Basic sanitation
  broad = stripSuspiciousBrandTokens(broad);
  exact = stripSuspiciousBrandTokens(exact);
  strict = stripSuspiciousBrandTokens(strict);

  // Hard rule: only allow FACTS.brand in the final queries
  broad = removeOtherBrands(broad, brand);
  exact = removeOtherBrands(exact, brand);
  strict = removeOtherBrands(strict, brand);
  const material = facts?.material ? String(facts.material) : null;
  const pattern = String(facts?.pattern || "").toLowerCase();

  // Always include brand in all queries if we have one
  broad = ensureToken(broad, brand);
  exact = ensureToken(exact, brand);
  strict = ensureToken(strict || exact, brand);

  // Include material in exact/strict; include in broad if it's a strong discriminator (e.g. patent leather)
  if (material && /patent leather|suede|denim|nylon/.test(material.toLowerCase())) {
    broad = ensureToken(broad, material);
  }
  exact = ensureToken(exact, material);
  strict = ensureToken(strict, material);

  // Ensure pattern tokens
  if (/monogram/.test(pattern)) {
    broad = ensureToken(broad, "monogram");
    exact = ensureToken(exact, "monogram");
    strict = ensureToken(strict, "monogram");
  }
  if (/quilt/.test(pattern)) {
    broad = ensureToken(broad, "quilted");
    exact = ensureToken(exact, "quilted");
    strict = ensureToken(strict, "quilted");
  }

  // Ensure strict prefix
  if (!normalizeQuery(strict).includes("authentic") || !normalizeQuery(strict).includes("genuine")) {
    strict = normalizeQuery(`authentic genuine ${strict}`);
  }

  return {
    ...b,
    suggestedQueries: {
      broad: normalizeQuery(broad),
      exact: normalizeQuery(exact),
      strict: normalizeQuery(strict),
    },
  };
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
  "category": string, // choose a search-friendly subtype label. Prefer from this bag taxonomy when itemType="bag": boston bag, top handle bag, tote bag, shoulder bag, crossbody bag, hobo bag, bucket bag, clutch. IMPORTANT: treat "bowler bag" as "boston bag" (use the label "boston bag"). Use "unknown" if unclear.
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
- HOWEVER: if an iconic logo cue is clearly visible (e.g. adidas three stripes, onitsuka tiger stripes, mcqueen skull hardware, balenciaga city bag cues, margiela four stitches), you may set brand as a best-effort guess (confidence must be medium/low).
- If the brand name/logo text is clearly visible, set brand.
- If the brand is not text-visible but the item has a very distinctive, widely-known monogram/logo pattern (e.g. LV monogram, Dior oblique, Gucci GG, Chanel quilting + CC lock), you MAY set brand as a best-effort guess BUT then:
  - set confidence="medium" or "low" (never "high")
  - explain in notes that it was inferred from monogram/logo cues.
- If no strong signal: brand=null and confidence="low".
- If multiple items are present: focus on the most central / primary item.
- Keep keyVisualCues short (2-12 items), and INCLUDE iconic logo cues when present:
  - "three stripes" (adidas)
  - "tiger stripes" (onitsuka tiger)
  - "skull hardware" / "skull buckle" (alexander mcqueen)
  - "city bag" / "motorcycle bag" / "giant studs" (balenciaga)
  - "four stitches" / "numbers label" (maison margiela)
  Examples: "monogram canvas", "city bag", "giant studs", "bowler shape", "top handles", "chunky sole", "three stripes", "tiger stripes", "skull buckle", "diamond quilting", "logo patch".
- Optional user hint text: ${userHint ? JSON.stringify(userHint) : "(none)"}.
`.trim();
}

function buildPromptIconicBagClassifier(args: { facts: any }) {
  const { facts } = args;
  const items = ICONIC_BAGS_TOP20.map((x) => ({ id: x.id, label: x.label }));

  return `
You are classifying whether an image shows one of the following iconic resale bags.
Only choose an item if you are reasonably confident from visible shape/logo cues.
If not confident, return id=null.
Return ONLY JSON.

Candidates:
${JSON.stringify(items, null, 2)}

Context facts (may be incomplete):
${JSON.stringify(
  {
    itemType: facts?.itemType,
    category: facts?.category,
    color: facts?.color,
    material: facts?.material,
    pattern: facts?.pattern,
    keyVisualCues: facts?.keyVisualCues,
    visibleText: facts?.visibleText,
  },
  null,
  2
)}

JSON schema:
{
  "id": string|null,
  "confidence": "high"|"medium"|"low",
  "evidence": string[]
}

Rules:
- If you choose an id, evidence must mention 2-5 concrete visible cues (e.g. "braided handles", "front zip pocket", "saddle silhouette", "puzzle paneling", "triomphe clasp").
- If id is null, confidence must be "low".
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
- broad: maximize recall; include brand (if present), category, and include ONE coarse color token when present (black/white/beige/brown/red/blue/green/grey/pink/multicolor).
- If pattern indicates monogram or quilted, include the token "monogram" or "quilted" in broad.
- NEVER invent a different brand name. If brand is not in FACTS.brand, do not add any brand-looking token.
- exact: include model ONLY if confidence is high and model is present.
- strict: add "authentic genuine".
- Avoid: replica, dupe, inspired, style, lookalike.
- Prefer lowercase, spaces, no punctuation.
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
  // Apply allowlist + evidence rules to avoid OCR hallucinations.
  const visibleText = Array.isArray(c?.visibleText) ? c.visibleText.join(" ").toLowerCase() : "";
  const cuesText = Array.isArray(a?.keyVisualCues) ? a.keyVisualCues.join(" ").toLowerCase() : "";
  const patternText = String(a?.pattern || "").toLowerCase();
  const signals = `${visibleText} ${patternText} ${cuesText}`;

  let brand = acceptBrand(pickFirstNonEmpty(a?.brand, c?.bestBrandGuess), { visibleText, signals });

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

    const normFacts = normalizeFactsForQuery(facts);

    // v0: rule-based iconic detection
    const iconicHits = detectIconicModels(normFacts);
    let bestIconic = iconicHits[0] || null;

    // v1: for bags, run a constrained classifier over the Top-20 list (higher recall for classic shapes)
    if ((normFacts as any).itemType === "bag") {
      try {
        const cls = await callVisionJSON({ dataUrl, prompt: buildPromptIconicBagClassifier({ facts: normFacts }) });
        if (cls && cls.id && cls.confidence && cls.confidence !== "low") {
          const picked = ICONIC_BAGS_TOP20.find((x) => x.id === cls.id);
          if (picked) {
            bestIconic = {
              id: picked.id,
              label: picked.label,
              brand: picked.brand,
              model: picked.model,
              score: cls.confidence === "high" ? 10 : 7,
              evidence: Array.isArray(cls.evidence) ? cls.evidence : [],
            } as any;
          }
        }
      } catch {
        // ignore classifier errors; fall back to rule engine
      }
    }

    // If iconic model triggers, promote brand/model/category signals for query generation.
    if (bestIconic) {
      normFacts.brand = bestIconic.brand;
      (normFacts as any).model = normFacts.model || bestIconic.model;
      (normFacts as any).iconicModelCandidates = iconicHits;
    }

    // B uses only normalized facts (coarse color + pattern tokens)
    const b0 = await callTextJSON({ prompt: buildPromptBFromFacts({ userHint: userText, facts: normFacts }) });
    const b = postprocessQueries(normFacts, b0);

    const merged0 = mergeEnsemble(a, b, c);

    // Attach iconic model hits for UI/debugging
    const merged = {
      ...merged0,
      iconicModelCandidates: (normFacts as any).iconicModelCandidates || [],
      iconicModel: bestIconic ? { id: bestIconic.id, label: bestIconic.label, brand: bestIconic.brand, model: bestIconic.model, score: bestIconic.score } : null,
    };
    cache.set(key, { ts: now(), value: merged });

    return NextResponse.json(merged);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Vision error" }, { status: 500 });
  }
}
