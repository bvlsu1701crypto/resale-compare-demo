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

function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function weekStartDate(daysBack = 7) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

function normalizeQuery(q) {
  return String(q || "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(q) {
  const norm = normalizeQuery(q);
  if (!norm) return new Set();
  return new Set(norm.split(" ").filter(Boolean));
}

function f1Score(a, b) {
  const aSet = tokenSet(a);
  const bSet = tokenSet(b);
  if (aSet.size === 0 && bSet.size === 0) return 1;
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let inter = 0;
  for (const t of aSet) if (bSet.has(t)) inter += 1;
  const precision = inter / aSet.size;
  const recall = inter / bSet.size;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

async function main() {
  const db = await notion(`/databases/${DB_ID}`, { method: "GET" });
  const dsId = Array.isArray(db?.data_sources) ? db.data_sources[0]?.id : null;
  if (!dsId) throw new Error("Database has no data_source_id");

  const startDate = weekStartDate(7);
  let cursor = undefined;
  const rows = [];

  for (let i = 0; i < 5; i++) {
    const body = {
      page_size: 50,
      ...(cursor ? { start_cursor: cursor } : {}),
      sorts: [{ property: "Created At", direction: "descending" }],
      filter: {
        property: "Created At",
        date: { on_or_after: startDate },
      },
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

  const labeled = rows.filter((r) => r.bestQuery);

  const weekKey = isoWeekKey(new Date());
  const outDir = path.join(process.cwd(), "eval", "training");
  fs.mkdirSync(outDir, { recursive: true });
  const trainPath = path.join(outDir, `train-${weekKey}.jsonl`);

  const jsonl = labeled
    .map((r) =>
      JSON.stringify({
        name: r.name,
        platform: r.platform,
        queryMode: r.queryMode,
        autoQuery: r.autoQuery,
        bestQuery: r.bestQuery,
        notes: r.notes,
        imageUrl: r.imageUrl,
        createdAt: r.createdAt,
        url: r.url,
      })
    )
    .join("\n");
  fs.writeFileSync(trainPath, jsonl + (jsonl ? "\n" : ""), "utf8");

  // Simple evaluation: baseline vs. a learned mapping from autoQuery -> bestQuery.
  const mapping = new Map();
  for (const r of labeled) {
    const key = normalizeQuery(r.autoQuery);
    if (!key) continue;
    if (!mapping.has(key)) mapping.set(key, r.bestQuery);
  }

  const evalRows = labeled.map((r) => {
    const key = normalizeQuery(r.autoQuery);
    const predicted = mapping.get(key) || r.autoQuery;
    return {
      ...r,
      predicted,
      baseF1: f1Score(r.autoQuery, r.bestQuery),
      trainedF1: f1Score(predicted, r.bestQuery),
    };
  });

  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const baseAvg = avg(evalRows.map((r) => r.baseF1));
  const trainedAvg = avg(evalRows.map((r) => r.trainedF1));

  const report = [];
  report.push(`# Weekly training report (${weekKey})`);
  report.push("");
  report.push(`- Date range: ${startDate} → ${todayKey()}`);
  report.push(`- Total rows pulled: **${rows.length}**`);
  report.push(`- Rows with Best Query: **${labeled.length}**`);
  report.push("");
  report.push("## Accuracy (token F1)\n");
  report.push(`- Baseline (auto → best): **${baseAvg.toFixed(3)}**`);
  report.push(`- Trained (mapped → best): **${trainedAvg.toFixed(3)}**`);
  report.push(`- Delta: **${(trainedAvg - baseAvg).toFixed(3)}**`);

  const worst = evalRows
    .filter((r) => r.trainedF1 < 0.6)
    .slice(0, 5)
    .map((r, idx) =>
      [
        `${idx + 1}. ${r.platform || "(blank)"} | ${r.url}`,
        `   - auto: ${r.autoQuery}`,
        `   - best: ${r.bestQuery}`,
        `   - predicted: ${r.predicted}`,
        `   - baseF1: ${r.baseF1.toFixed(3)} | trainedF1: ${r.trainedF1.toFixed(3)}`,
      ].join("\n")
    );

  if (worst.length) {
    report.push("\n## Low-accuracy samples (top 5)\n");
    report.push(worst.join("\n"));
  }

  const reportDir = path.join(process.cwd(), "eval", "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `training-report-${weekKey}.md`);
  fs.writeFileSync(reportPath, report.join("\n") + "\n", "utf8");

  console.log(`Wrote ${trainPath}`);
  console.log(`Wrote ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
