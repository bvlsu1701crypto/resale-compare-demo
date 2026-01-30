import { NextResponse } from "next/server";

type Listing = {
  source: "ebay" | "etsy" | "vinted" | "depop" | "vestiaire";
  title?: string;
  price?: number;
  currency?: "EUR" | "USD" | "GBP";
  image?: string;
  url: string;
  shipping?: number;
  fee?: number;
};

function cleanText(s: string) {
  return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function toNumber(s: string) {
  const cleaned = s.replace(/[^\d.,]/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Demo conversion (good enough for portfolio demo)
function toEUR(price: number, currency: Listing["currency"]) {
  if (!currency || currency === "EUR") return price;
  const rates: Record<string, number> = {
    USD: 0.92,
    GBP: 1.17,
  };
  return price * (rates[currency] ?? 1);
}

function makeSearchLinks(q: string): Listing[] {
  const qq = encodeURIComponent(q);
  return [
    { source: "vinted", url: `https://www.vinted.com/catalog?search_text=${qq}` },
    { source: "depop", url: `https://www.depop.com/search/?q=${qq}` },
    { source: "vestiaire", url: `https://www.vestiairecollective.com/search/?q=${qq}` },
  ];
}

async function fetchHtml(url: string) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "accept-language": "en-GB,en;q=0.9",
    },
    next: { revalidate: 60 },
  });
  return await res.text();
}

/**
 * eBay: Prefer official Browse API (stable + deploy-friendly).
 * Falls back to HTML scraping only if credentials are missing.
 */
let ebayTokenCache:
  | { accessToken: string; expiresAtMs: number }
  | null = null;

async function getEbayAppToken() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  // Reuse token if still valid (with a small safety margin)
  const now = Date.now();
  if (ebayTokenCache && now < ebayTokenCache.expiresAtMs - 60_000) {
    return ebayTokenCache.accessToken;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope",
  });

  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    // token endpoint should not be cached
    cache: "no-store",
  });

  if (!res.ok) {
    // Avoid leaking secrets; return null so caller can fallback
    return null;
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  ebayTokenCache = {
    accessToken: json.access_token,
    expiresAtMs: Date.now() + json.expires_in * 1000,
  };

  return json.access_token;
}

async function searchEbayViaApi(q: string): Promise<Listing[]> {
  const token = await getEbayAppToken();
  if (!token) throw new Error("EBAY_TOKEN_UNAVAILABLE");

  const marketplace = process.env.EBAY_MARKETPLACE_ID || "EBAY_GB";

  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "8");

  const res = await fetch(url.toString(), {
    headers: {
      authorization: `Bearer ${token}`,
      "x-ebay-c-marketplace-id": marketplace,
    },
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    throw new Error(`EBAY_API_${res.status}`);
  }

  type EbayPrice = { value: string; currency: string };
  type EbayImage = { imageUrl: string };
  type EbayItemSummary = {
    title?: string;
    itemWebUrl?: string;
    itemHref?: string;
    image?: EbayImage;
    price?: EbayPrice;
  };
  type EbayBrowseResponse = {
    itemSummaries?: EbayItemSummary[];
  };

  const json = (await res.json()) as EbayBrowseResponse;
  const items = Array.isArray(json?.itemSummaries) ? json.itemSummaries : [];

  if (items.length === 0) {
    const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`;
    return [{ source: "ebay", url: searchUrl }];
  }

  const mapped = items.slice(0, 8).map((it) => {
    const priceVal = it.price?.value != null ? Number(it.price.value) : undefined;
    const currency = it.price?.currency as Listing["currency"] | undefined;

    const urlOut =
      typeof it.itemWebUrl === "string"
        ? it.itemWebUrl
        : typeof it.itemHref === "string"
          ? it.itemHref
          : null;

    return {
      source: "ebay" as const,
      title: typeof it.title === "string" ? cleanText(it.title) : undefined,
      url: urlOut,
      image: typeof it.image?.imageUrl === "string" ? it.image.imageUrl : undefined,
      price: Number.isFinite(priceVal as number) ? (priceVal as number) : undefined,
      currency: currency ?? undefined,
      fee: 0,
      shipping: 0,
    };
  });

  // Ensure url is always present (required by Listing)
  const out = mapped.flatMap((x) => {
    if (typeof x.url !== "string" || x.url.length === 0) return [];
    const { url, ...rest } = x;
    const listing: Listing = { ...rest, url };
    return [listing];
  });

  return out;
}

async function searchEbayViaHtml(q: string): Promise<Listing[]> {
  const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`;
  const html = await fetchHtml(searchUrl);

  const linkMatches = [...html.matchAll(/class="s-item__link"[^>]*href="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => u && u.includes("/itm/"));

  const urls = Array.from(new Set(linkMatches)).slice(0, 8);
  if (urls.length === 0) return [{ source: "ebay", url: searchUrl }];

  const priceMatches = [...html.matchAll(/class="s-item__price"[^>]*>([^<]+)</g)].map((m) => m[1]);
  const imgMatches = [...html.matchAll(/class="s-item__image-img"[^>]*src="([^"]+)"/g)].map((m) => m[1]);

  return urls.map((u, i) => {
    const rawPrice = priceMatches[i] ?? "";
    const priceNum = toNumber(rawPrice);

    let currency: Listing["currency"] = "USD";
    if (rawPrice.includes("EUR")) currency = "EUR";
    if (rawPrice.includes("GBP") || rawPrice.includes("£")) currency = "GBP";
    if (rawPrice.includes("$")) currency = "USD";

    return {
      source: "ebay",
      url: u,
      image: imgMatches[i],
      price: priceNum ?? undefined,
      currency,
      fee: 0,
      shipping: 0,
    };
  });
}

async function searchEbay(q: string): Promise<Listing[]> {
  try {
    return await searchEbayViaApi(q);
  } catch {
    return await searchEbayViaHtml(q);
  }
}

// Etsy scraping removed for deploy stability (links only).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ q, results: [] });

  const ebayRes = await Promise.allSettled([searchEbay(q)]);

  const results: Listing[] = [];
  if (ebayRes[0].status === "fulfilled") results.push(...ebayRes[0].value);

  // Add other platforms as search links (no scraping)
  results.push(...makeSearchLinks(q));

  // Convert all numeric prices into EUR for demo consistency
  const normalized = results.map((r) => {
    if (typeof r.price === "number") {
      const eur = toEUR(r.price, r.currency);
      return { ...r, price: Math.round(eur * 100) / 100, currency: "EUR" as const };
    }
    return r;
  });

  return NextResponse.json({ q, results: normalized });
}