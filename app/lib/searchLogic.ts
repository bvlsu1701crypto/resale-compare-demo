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

export function platformUrl(p: Platform, query: string, vision?: any, chips: Chip[] = []) {
  const finalQuery = p === "ebay" ? buildEbayQuery(query, chips) : query;
  const q = encodeURIComponent(finalQuery);

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
  if (p === "ebay") return "https://www.ebay.co.uk/"; // camera icon in search bar
  if (p === "vinted") return "https://www.vinted.co.uk/"; // has "Image search" button

  // Xianyu: best-effort deep link to app; fallback to download/web handled by our redirect page.
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
  // Toggling/deleting chips must change the query.
  const on = chips.filter((c) => c.on).map((c) => c.text);
  const get = (k: string) => chips.find((c) => c.kind === k && c.on)?.text;

  // Prefer iconic model when present (it is the most search-useful signal)
  const iconicLabel = cleanToken(vision?.iconicModel?.label);

  const category =
    get("category") || cleanToken(vision?.category) || cleanToken(vision?.itemType) || "item";
  const brand = get("brand");
  const model = get("model");
  const color = get("color");
  const material = get("material");
  const pattern = get("pattern");

  if (kind === "strict") {
    return normalizeSpaces(
      [
        iconicLabel,
        brand,
        model,
        category,
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
    return normalizeSpaces(
      [iconicLabel, brand, model, category, color, material, pattern, ...on]
        .filter(Boolean)
        .join(" ")
    );
  }

  // broad / chips
  return normalizeSpaces([iconicLabel, brand, category, color, material, ...on].filter(Boolean).join(" "));
}
