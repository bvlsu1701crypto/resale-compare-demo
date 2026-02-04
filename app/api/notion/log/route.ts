import { NextResponse } from "next/server";

export const runtime = "nodejs";

const NOTION_VERSION = "2025-09-03";

function getNotionKey() {
  // Prefer env for Vercel deploy. Local dev can also set it.
  const k = process.env.NOTION_KEY || process.env.NOTION_API_KEY;
  return k || null;
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
  if (!res.ok) {
    const msg = json?.message || `Notion error ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

async function getTitlePropertyName(databaseId: string): Promise<string> {
  const db = await notionFetch(`/databases/${databaseId}`, { method: "GET" });
  const props = db?.properties || {};

  for (const [name, meta] of Object.entries(props)) {
    if ((meta as any)?.type === "title") return name;
  }

  // Common fallbacks (English/Chinese)
  if (props?.Name) return "Name";
  if (props?.["名称"]) return "名称";
  return "Name";
}

async function ensureDatabaseSchema(databaseId: string) {
  // Create properties if missing. Safe to call repeatedly.
  const db = await notionFetch(`/databases/${databaseId}`, { method: "GET" });
  const props = db?.properties || {};

  const patch: any = { properties: {} };

  function need(name: string) {
    return !Object.prototype.hasOwnProperty.call(props, name);
  }

  // Name title usually exists; we won't rename it.
  if (need("Platform")) patch.properties.Platform = { select: { options: [] } };
  if (need("Image URL")) patch.properties["Image URL"] = { url: {} };
  if (need("Best Query")) patch.properties["Best Query"] = { rich_text: {} };
  if (need("Query Mode")) {
    patch.properties["Query Mode"] = {
      select: { options: [{ name: "broad" }, { name: "exact" }, { name: "strict" }] },
    };
  }
  if (need("Auto Query")) patch.properties["Auto Query"] = { rich_text: {} };
  if (need("Vision JSON")) patch.properties["Vision JSON"] = { rich_text: {} };
  if (need("Notes")) patch.properties.Notes = { rich_text: {} };
  if (need("Created At")) patch.properties["Created At"] = { date: {} };

  const hasAny = Object.keys(patch.properties).length > 0;
  if (!hasAny) return;

  await notionFetch(`/databases/${databaseId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const databaseId = String(body?.databaseId || "").trim();
    if (!databaseId) return NextResponse.json({ error: "Missing databaseId" }, { status: 400 });

    await ensureDatabaseSchema(databaseId);

    const name = String(body?.name || "PreloveFinder Sample").slice(0, 180);
    const platform = String(body?.platform || "eBay UK").slice(0, 80);
    const imageUrl = body?.imageUrl ? String(body.imageUrl).slice(0, 2000) : "";
    const bestQuery = body?.bestQuery ? String(body.bestQuery).slice(0, 1000) : "";
    const queryMode = body?.queryMode ? String(body.queryMode).slice(0, 40) : "broad";
    const autoQuery = body?.autoQuery ? String(body.autoQuery).slice(0, 1000) : "";
    const visionJson = body?.visionJson ? String(body.visionJson).slice(0, 2000) : "";
    const notes = body?.notes ? String(body.notes).slice(0, 2000) : "";

    const titleProp = await getTitlePropertyName(databaseId);

    const page = await notionFetch(`/pages`, {
      method: "POST",
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: {
          [titleProp]: { title: [{ text: { content: name } }] },
          Platform: { select: { name: platform } },
          ...(imageUrl ? { "Image URL": { url: imageUrl } } : {}),
          ...(bestQuery ? { "Best Query": { rich_text: [{ text: { content: bestQuery } }] } } : {}),
          "Query Mode": { select: { name: queryMode } },
          ...(autoQuery ? { "Auto Query": { rich_text: [{ text: { content: autoQuery } }] } } : {}),
          ...(visionJson ? { "Vision JSON": { rich_text: [{ text: { content: visionJson } }] } } : {}),
          ...(notes ? { Notes: { rich_text: [{ text: { content: notes } }] } } : {}),
          "Created At": { date: { start: new Date().toISOString() } },
        },
      }),
    });

    return NextResponse.json({ ok: true, pageId: page?.id, url: page?.url });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Notion log failed" }, { status: 500 });
  }
}
