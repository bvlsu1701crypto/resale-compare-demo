import { NextResponse } from "next/server";

export const runtime = "nodejs";

const NOTION_VERSION = "2025-09-03";
const DEFAULT_DB_ID = "2fd71368-38d5-8043-8d17-d70ea85ddca1";

function getNotionKey() {
  return process.env.NOTION_KEY || process.env.NOTION_API_KEY || null;
}

async function notionFetch(path: string, init?: RequestInit) {
  const key = getNotionKey();
  if (!key) throw new Error("MISSING_NOTION_KEY");

  const url = `https://api.notion.com/v1${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `Notion error ${res.status}`);
  return json;
}

async function getDataSourceIdForDatabase(databaseId: string) {
  const db = await notionFetch(`/databases/${databaseId}`, { method: "GET" });
  const ds = Array.isArray(db?.data_sources) ? db.data_sources[0] : null;
  return ds?.id ? String(ds.id) : null;
}

function pickText(prop: any) {
  if (!prop) return "";
  if (prop.type === "rich_text") return (prop.rich_text || []).map((x: any) => x.plain_text).join("").trim();
  if (prop.type === "title") return (prop.title || []).map((x: any) => x.plain_text).join("").trim();
  return "";
}

function pickSelect(prop: any) {
  return prop?.select?.name || "";
}

function normalize(s: string) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenSet(s: string) {
  return new Set(normalize(s).split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
}

let cache: { ts: number; rows: Array<{ platform: string; auto: string; best: string }> } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

async function loadRows(databaseId: string) {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL_MS) return cache.rows;

  const dsId = await getDataSourceIdForDatabase(databaseId);
  if (!dsId) throw new Error("Database has no data_source_id");

  const rows: Array<{ platform: string; auto: string; best: string }> = [];
  let cursor: string | undefined = undefined;

  for (let i = 0; i < 5; i++) {
    const body: any = {
      page_size: 50,
      sorts: [{ property: "Created At", direction: "descending" }],
      ...(cursor ? { start_cursor: cursor } : {}),
    };

    const resp = await notionFetch(`/data_sources/${dsId}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    const results = Array.isArray(resp?.results) ? resp.results : [];
    for (const r of results) {
      const p = r.properties || {};
      const platform = pickSelect(p.Platform) || "";
      const auto = pickText(p["Auto Query"]) || "";
      const best = pickText(p["Best Query"]) || "";
      if (!platform || !auto || !best) continue;
      rows.push({ platform, auto, best });
    }

    if (!resp?.has_more) break;
    cursor = resp?.next_cursor;
  }

  cache = { ts: now, rows };
  return rows;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const databaseId = (searchParams.get("databaseId") || process.env.NOTION_FEEDBACK_DB_ID || DEFAULT_DB_ID).trim();
    const platform = (searchParams.get("platform") || "eBay UK").trim();
    const autoQuery = (searchParams.get("autoQuery") || "").trim();

    if (!autoQuery) return NextResponse.json({ suggestedQuery: "", reason: "missing_autoQuery" });

    const rows = await loadRows(databaseId);
    const candidates = rows.filter((r) => r.platform === platform);

    const aSet = tokenSet(autoQuery);

    let best: { q: string; score: number; auto: string } | null = null;
    for (const r of candidates) {
      const s = jaccard(aSet, tokenSet(r.auto));
      if (!best || s > best.score) best = { q: r.best, score: s, auto: r.auto };
    }

    if (!best || best.score < 0.55) {
      const score = best ? best.score : 0;
      return NextResponse.json({ suggestedQuery: autoQuery, reason: "no_close_match", score });
    }

    return NextResponse.json({ suggestedQuery: best.q, reason: "matched_history", score: best.score, matchedAuto: best.auto });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "suggest failed" }, { status: 500 });
  }
}
