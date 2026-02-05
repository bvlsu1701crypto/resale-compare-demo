export type Lang = "en" | "zh";
export type Strategy = "broad" | "exact" | "strict" | "chips";
export type Platform = "ebay" | "vinted" | "depop" | "vestiaire" | "etsy" | "xianyu";

export type Chip = { id: string; text: string; on: boolean; kind?: string };

export function normalizeSpaces(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

export function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

export function cleanToken(s: string) {
  return normalizeSpaces(String(s || ""))
    .replace(/[^\p{L}\p{N}\s\-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Build platform URLs without scraping ---
export function ebayCategoryIdFromVision(v: any): string | null {
  const cat = String(v?.category || "").toLowerCase();
  const itemType = String(v?.itemType || "").toLowerCase();

  // Best-effort eBay category ids (works reasonably well for UK too).
  // Women\'s Handbags & Bags
  if (
    itemType === "bag" ||
    cat.includes("bag") ||
    cat.includes("handbag") ||
    cat.includes("tote") ||
    cat.includes("shoulder") ||
    cat.includes("crossbody")
  ) {
    return "169291";
  }

  return null;
}

export function buildEbayQuery(query: string, chips: Chip[]) {
  // Append enabled chips to query (dedupe) so user selections always influence eBay search.
  const base = normalizeSpaces(query);
  const extras = chips
    .filter((c) => c.on)
    .map((c) => cleanToken(c.text))
    .filter(Boolean);

  const tokens = uniq(
    normalizeSpaces([base, ...extras].join(" "))
      .split(" ")
      .map((x) => x.trim())
      .filter(Boolean)
  );

  return normalizeSpaces(tokens.join(" "));
}

function hasChinese(s: string) {
  return /[\u4e00-\u9fff]/.test(s);
}

const XIAN_YU_DICT: Record<string, string> = {
  bag: "包",
  handbag: "手提包",
  shoulder: "单肩",
  crossbody: "斜挎",
  "cross-body": "斜挎",
  tote: "托特",
  backpack: "双肩包",
  wallet: "钱包",
  purse: "包",
  shoes: "鞋",
  sneaker: "运动鞋",
  sneakers: "运动鞋",
  boots: "靴子",
  coat: "外套",
  jacket: "夹克",
  dress: "连衣裙",
  skirt: "裙子",
  pants: "裤子",
  jeans: "牛仔裤",
  leather: "皮",
  canvas: "帆布",
  nylon: "尼龙",
  black: "黑色",
  white: "白色",
  brown: "棕色",
  beige: "米色",
  blue: "蓝色",
  red: "红色",
  green: "绿色",
  pink: "粉色",
  silver: "银色",
  gold: "金色",
  mini: "迷你",
  small: "小号",
  medium: "中号",
  large: "大号",
  authentic: "正品",
  genuine: "正品",
};

function translateToXianyuZh(query: string) {
  const raw = normalizeSpaces(query);
  if (!raw || hasChinese(raw)) return raw;

  const tokens = raw.split(" ");
  const translated = tokens.map((t) => XIAN_YU_DICT[t.toLowerCase()] || t);
  return normalizeSpaces(translated.join(" "));
}

export function xianyuAppUrl(query: string) {
  const zh = translateToXianyuZh(query);
  return `/go/xianyu-image?q=${encodeURIComponent(zh)}`;
}

export function platformUrl(p: Platform, query: string, vision?: any, chips: Chip[] = []) {
  const finalQuery = p === "ebay" ? buildEbayQuery(query, chips) : query;
  const q = encodeURIComponent(p === "xianyu" ? translateToXianyuZh(finalQuery) : finalQuery);

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

  // Xianyu best-effort keyword search (may vary by device/login)
  if (p === "xianyu") return `https://2.taobao.com/search?q=${q}`;

  return "#";
}

// Best-effort entrypoints for platform visual search (image search).
// NOTE: Browsers cannot auto-upload the user's local file to another site.
// This only opens the platform's image-search entry so the user can upload manually.
export function platformImageSearchUrl(p: Platform): string | null {
  // NOTE: We cannot auto-upload a local image to other sites from a browser.
  // So we open a guided entry page that then jumps to the platform's image-search entry.
  if (p === "ebay") return "/go/ebay-image";
  if (p === "vinted") return "/go/vinted-image";

  // Xianyu: deep link to app + fallback handled by our redirect page.
  if (p === "xianyu") return "/go/xianyu-image";

  // Most others are app-only or not reliably available on web.
  return null;
}


export function logoFor(p: Platform) {
  return `/logos/${p}.png`;
}

export function buildQuery(args: {
  kind: Strategy;
  chips: Chip[];
  vision: any;
}): string {
  const { kind, chips, vision } = args;

  // IMPORTANT UX: the "Detected keywords" chips are the source of truth.
  // For broad mode we intentionally keep it conservative to avoid over-filtering.
  const get = (k: string) => chips.find((c) => c.kind === k && c.on)?.text;

  // Prefer iconic model when present (it is the most search-useful signal)
  const iconicLabel = cleanToken(vision?.iconicModel?.label);

  const itemType = cleanToken(vision?.itemType);
  const isBag = itemType === "bag";

  const brand = get("brand");
  const model = get("model");
  const color = get("color");
  const material = get("material");
  const pattern = get("pattern");

  const bagType = cleanToken(vision?.bagType) || cleanToken(vision?.category);
  const bagTypeConfidence = String(vision?.bagTypeConfidence || "");

  const conservativeCategory = isBag ? "bag" : itemType || "item";
  const exactCategory = isBag && bagTypeConfidence === "high" && bagType && bagType !== "unknown" ? bagType : conservativeCategory;

  // Which chips to include in broad mode (keep recall high)
  // Default: only brand/color/material.
  // BUT: if user explicitly enables a bag-type/category chip (e.g. "shoulder bag"), include it as an override.
  const broadChipTexts = chips
    .filter((c) => c.on)
    .filter((c) => {
      const k = String(c.kind || "");
      if (["brand", "color", "material"].includes(k)) return true;

      const txt = cleanToken(c.text).toLowerCase();
      if (k === "category" && /\bbag\b/.test(txt)) return true;

      return false;
    })
    .map((c) => c.text);

  if (kind === "strict") {
    // strict: allow more detail but still avoid forcing bagType if not confident
    const on = chips.filter((c) => c.on).map((c) => c.text);
    return normalizeSpaces(
      [
        iconicLabel,
        brand,
        model,
        exactCategory,
        color,
        material,
        pattern,
        "authentic genuine",
        ...on,
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  if (kind === "exact") {
    const on = chips.filter((c) => c.on).map((c) => c.text);
    return normalizeSpaces(
      [iconicLabel, brand, model, exactCategory, color, material, pattern, ...on]
        .filter(Boolean)
        .join(" ")
    );
  }

  // broad / chips: conservative base query to reduce "wrong bag type" failures.
  const baseBroad = [iconicLabel, brand, conservativeCategory, color, material, ...broadChipTexts]
    .filter(Boolean)
    .join(" ");

  // IMPORTANT: if the user explicitly turns on chips, they must appear in the query.
  const onAll = chips.filter((c) => c.on).map((c) => c.text);

  const tokens = uniq(
    normalizeSpaces([baseBroad, ...onAll].join(" "))
      .split(" ")
      .map((x) => x.trim())
      .filter(Boolean)
  );

  return normalizeSpaces(tokens.join(" "));
}

