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
 * eBay: parse common "s-item__link" anchors + nearby price/image.
 * If parsing fails, return only the search link (fallback).
 */
async function searchEbay(q: string): Promise<Listing[]> {
  const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`;
  const html = await fetchHtml(searchUrl);

  const linkMatches = [...html.matchAll(/class="s-item__link"[^>]*href="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => u && u.includes("/itm/"));

  const urls = Array.from(new Set(linkMatches)).slice(0, 8);
  if (urls.length === 0) return [{ source: "ebay", url: searchUrl }];

  // Try to also grab images/prices by scanning the whole document (best-effort)
  const priceMatches = [...html.matchAll(/class="s-item__price"[^>]*>([^<]+)</g)].map((m) => m[1]);
  const imgMatches = [...html.matchAll(/class="s-item__image-img"[^>]*src="([^"]+)"/g)].map((m) => m[1]);

  const items: Listing[] = urls.map((u, i) => {
    const rawPrice = priceMatches[i] ?? "";
    const priceNum = toNumber(rawPrice);

    // crude currency detect from symbol
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

  return items;
}

/**
 * Etsy: parse JSON-LD ItemList if present (most stable), else fallback to listing URLs only.
 */
async function searchEtsy(q: string): Promise<Listing[]> {
  const searchUrl = `https://www.etsy.com/search?q=${encodeURIComponent(q)}`;
  const html = await fetchHtml(searchUrl);

  // Try JSON-LD blocks first
  const scripts = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .filter(Boolean);

  for (const s of scripts) {
    try {
      const json = JSON.parse(s);
      // Sometimes it's an array of JSON-LD entries
      const entries = Array.isArray(json) ? json : [json];

      for (const entry of entries) {
        if (entry && entry["@type"] === "ItemList" && Array.isArray(entry.itemListElement)) {
          const out: Listing[] = [];
          for (const el of entry.itemListElement) {
            const item = el?.item;
            const url = item?.url;
            const image = Array.isArray(item?.image) ? item.image[0] : item?.image;
            const offers = item?.offers;
            const price = offers?.price != null ? Number(offers.price) : null;
            const currency = offers?.priceCurrency as Listing["currency"] | undefined;

            if (typeof url === "string") {
              out.push({
                source: "etsy",
                url,
                image: typeof image === "string" ? image : undefined,
                price: Number.isFinite(price as number) ? (price as number) : undefined,
                currency,
                fee: 0,
                shipping: 0,
              });
            }
            if (out.length >= 8) break;
          }

          if (out.length > 0) return out;
        }
      }
    } catch {
      // ignore and continue
    }
  }

  // Fallback: listing URLs only
  const urls = Array.from(
    new Set(
      [...html.matchAll(/href="(https:\/\/www\.etsy\.com\/listing\/\d+\/[^"?]+)[^"]*"/g)]
        .map((m) => m[1])
        .filter(Boolean)
    )
  ).slice(0, 8);

  if (urls.length === 0) return [{ source: "etsy", url: searchUrl }];
  return urls.map((u) => ({ source: "etsy", url: u, fee: 0, shipping: 0 }));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ q, results: [] });

  const [ebayRes, etsyRes] = await Promise.allSettled([searchEbay(q), searchEtsy(q)]);

  const results: Listing[] = [];
  if (ebayRes.status === "fulfilled") results.push(...ebayRes.value);
  if (etsyRes.status === "fulfilled") results.push(...etsyRes.value);

  // Add other platforms as search links
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