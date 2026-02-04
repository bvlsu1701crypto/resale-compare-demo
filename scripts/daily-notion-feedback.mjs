import fs from "node:fs";
import path from "node:path";

const NOTION_VERSION = "2025-09-03";
const DB_ID = "2fd71368-38d5-8043-8d17-d70ea85ddca1";

function readNotionKey() {
  const p = path.join(process.env.HOME || "", ".config/notion/api_key");
  if (process.env.NOTION_KEY) return process.env.NOTION_KEY;
  if (process.env.NOTION_API_KEY) return process.env.NOTION_API_KEY;
  if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").trim();
  return null;
}

async function notion(pathname, init = {}) {
  const key = readNotionKey();
  if (!key) throw new Error("Missing NOTION_KEY (set env or ~/.config/notion/api_key)");

  const url = new URL(pathname.replace(/^\/+/, ""), "https://api.notion.com/v1/");
  // debug (enable if needed)
  // console.log('NOTION_FETCH', url.toString());
  const res = await fetch(url.toString(), {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `Notion error ${res.status}`);
  return json;
}

function pickText(prop) {
  if (!prop) return "";
  if (prop.type === "rich_text") return (prop.rich_text || []).map((x) => x.plain_text).join("").trim();
  if (prop.type === "title") return (prop.title || []).map((x) => x.plain_text).join("").trim();
  return "";
}

function pickSelect(prop) {
  return prop?.select?.name || "";
}

function pickUrl(prop) {
  return prop?.url || "";
}

function pickDate(prop) {
  return prop?.date?.start || "";
}

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function scoreRow(row) {
  const autoQ = row.autoQuery.toLowerCase();
  const bestQ = row.bestQuery.toLowerCase();

  // quick heuristics
  const penaltyTokens = ["replica", "dupe", "inspired", "style", "lookalike"]; // we try to avoid these
  const hasPenalty = penaltyTokens.some((t) => bestQ.includes(t));

  const deltaLen = Math.max(0, bestQ.split(/\s+/).length - autoQ.split(/\s+/).length);
  return {
    hasPenalty,
    deltaLen,
  };
}

function mdEscape(s) {
  return String(s || "").replaceAll("\n", " ").trim();
}

async function main() {
  // In 2025-09-03 Notion API, query via data_sources.
  const db = await notion(`/databases/${DB_ID}`, { method: "GET" });
  const dsId = Array.isArray(db?.data_sources) ? db.data_sources[0]?.id : null;
  if (!dsId) throw new Error("Database has no data_source_id");

  let cursor = undefined;
  const rows = [];

  for (let i = 0; i < 5; i++) {
    const body = {
      page_size: 50,
      ...(cursor ? { start_cursor: cursor } : {}),
      sorts: [{ property: "Created At", direction: "descending" }],
    };

    const resp = await notion(`/data_sources/${dsId}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    const results = Array.isArray(resp.results) ? resp.results : [];
    for (const r of results) {
      const p = r.properties || {};
      rows.push({
        url: r.url,
        name: pickText(p["名称"] || p.Name || p["Name"]),
        platform: pickSelect(p.Platform),
        queryMode: pickSelect(p["Query Mode"]) || pickSelect(p["关键词模式"]) || pickText(p["Query Mode"]) || "",
        autoQuery: pickText(p["Auto Query"]) || "",
        bestQuery: pickText(p["Best Query"]) || "",
        imageUrl: pickUrl(p["Image URL"]) || "",
        notes: pickText(p.Notes) || "",
        createdAt: pickDate(p["Created At"]) || "",
      });
    }

    if (!resp.has_more) break;
    cursor = resp.next_cursor;
  }

  const total = rows.length;
  const filledBest = rows.filter((r) => r.bestQuery).length;

  // Summaries
  const byPlatform = {};
  for (const r of rows) {
    byPlatform[r.platform || "(blank)"] = (byPlatform[r.platform || "(blank)"] || 0) + 1;
  }

  const topEdits = rows
    .filter((r) => r.bestQuery && r.autoQuery)
    .slice(0, 30)
    .map((r) => ({ ...r, ...scoreRow(r) }));

  const report = [];
  report.push(`# PreloveFinder daily feedback report (${todayKey()})`);
  report.push("");
  report.push(`- Total rows pulled: **${total}**`);
  report.push(`- Rows with Best Query filled: **${filledBest}**`);
  report.push(`- By platform: ${Object.entries(byPlatform)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" | ")}`);
  report.push("");

  report.push("## Recent labeled examples (top 10)");
  report.push("");
  report.push(
    rows
      .filter((r) => r.bestQuery || r.autoQuery)
      .slice(0, 10)
      .map((r, idx) =>
        [
          `${idx + 1}. ${mdEscape(r.platform)} | mode=${mdEscape(r.queryMode)} | ${r.url}`,
          `   - auto: ${mdEscape(r.autoQuery)}`,
          `   - best: ${mdEscape(r.bestQuery)}`,
          r.notes ? `   - notes: ${mdEscape(r.notes)}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      )
      .join("\n")
  );

  report.push("");
  report.push("## Heuristic checks");
  report.push("");
  const penalties = topEdits.filter((r) => r.hasPenalty);
  report.push(`- Best Query contains banned-ish tokens (replica/dupe/etc): **${penalties.length}**`);

  const outDir = path.join(process.cwd(), "eval", "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `feedback-${todayKey()}.md`);
  fs.writeFileSync(outPath, report.join("\n") + "\n", "utf8");

  console.log(`Wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
