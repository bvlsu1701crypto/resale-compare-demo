import { NextResponse } from "next/server";

export const runtime = "nodejs";

let ebayTokenCache: { accessToken: string; expiresAtMs: number } | null = null;

async function getEbayAppToken() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

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
    cache: "no-store",
  });

  if (!res.ok) return null;

  const json = (await res.json()) as { access_token: string; expires_in: number };
  ebayTokenCache = {
    accessToken: json.access_token,
    expiresAtMs: Date.now() + json.expires_in * 1000,
  };

  return json.access_token;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const limit = Math.max(1, Math.min(60, Number(searchParams.get("limit") || 60)));

  if (!q) return NextResponse.json({ q, items: [] });

  const token = await getEbayAppToken();
  if (!token) {
    return NextResponse.json(
      {
        error: "Missing EBAY_CLIENT_ID/EBAY_CLIENT_SECRET",
      },
      { status: 400 }
    );
  }

  const marketplace = process.env.EBAY_MARKETPLACE_ID || "EBAY_GB";

  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), {
    headers: {
      authorization: `Bearer ${token}`,
      "x-ebay-c-marketplace-id": marketplace,
    },
    cache: "no-store",
  });

  const json = await res.json();
  if (!res.ok) {
    return NextResponse.json({ error: "eBay API error", status: res.status, body: json }, { status: 502 });
  }

  const items = Array.isArray(json?.itemSummaries) ? json.itemSummaries : [];
  const mapped = items
    .map((it: any) => ({
      itemId: it.itemId,
      title: it.title,
      itemWebUrl: it.itemWebUrl,
      imageUrl: it.image?.imageUrl,
      price: it.price,
    }))
    .filter((x: any) => x.itemWebUrl && x.imageUrl);

  return NextResponse.json({ q, items: mapped });
}
