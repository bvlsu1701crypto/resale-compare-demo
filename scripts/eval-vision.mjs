#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

const baseUrl = arg("--baseUrl", "http://localhost:3000");
const datasetPath = arg("--dataset", "eval/dataset.jsonl");

function readJsonl(p) {
  const lines = fs
    .readFileSync(p, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.map((l) => JSON.parse(l));
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function containsLoose(a, b) {
  const A = norm(a);
  const B = norm(b);
  if (!A || !B) return false;
  return A.includes(B) || B.includes(A);
}

async function callVision({ imagePath, hint = "" }) {
  const buf = fs.readFileSync(imagePath);
  const file = new File([buf], path.basename(imagePath), { type: "image/jpeg" });
  const form = new FormData();
  form.append("image", file);
  form.append("text", hint);

  const res = await fetch(`${baseUrl}/api/vision`, { method: "POST", body: form });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

function hasBadWords(q) {
  const bad = ["replica", "dupe", "inspired", "lookalike", "style"]; // we discourage these
  const s = norm(q);
  return bad.filter((w) => s.includes(w));
}

async function main() {
  const rows = readJsonl(datasetPath);

  let brandTotal = 0,
    brandHit = 0;
  let catTotal = 0,
    catHit = 0;
  let strictTotal = 0,
    strictHasAuth = 0;
  let badWordCount = 0;

  const details = [];

  for (const r of rows) {
    const image = r.image;
    const expected = r.expected || {};

    const out = await callVision({ imagePath: image, hint: r.hint || "" });

    const expBrand = expected.brand ?? null;
    const expCat = expected.category ?? null;

    const outBrand = out.brand ?? null;
    const outCat = out.category ?? null;

    const qBroad = out?.suggestedQueries?.broad || "";
    const qExact = out?.suggestedQueries?.exact || "";
    const qStrict = out?.suggestedQueries?.strict || "";
    const allQ = `${qBroad} ${qExact} ${qStrict}`;

    // For resale search, the *query* matters more than the structured brand field.
    // We accept a brand hit if either:
    // - structured out.brand matches expected, OR
    // - expected brand appears in any suggested query (case-insensitive)
    let brandOk = null;
    if (expBrand) {
      brandTotal++;
      const structuredOk = norm(outBrand) === norm(expBrand);
      const queryOk = norm(allQ).includes(norm(expBrand));
      brandOk = structuredOk || queryOk;
      if (brandOk) brandHit++;
    }

    // Category: accept if out.category loosely matches expected OR expected appears in broad query
    let catOk = null;
    if (expCat) {
      catTotal++;
      const structuredOk = containsLoose(outCat, expCat);
      const queryOk = norm(qBroad).includes(norm(expCat));
      catOk = structuredOk || queryOk;
      if (catOk) catHit++;
    }

    strictTotal++;
    const strictQ = out?.suggestedQueries?.strict || "";
    if (norm(strictQ).includes("authentic") && norm(strictQ).includes("genuine")) strictHasAuth++;

    const bad = [
      ...hasBadWords(out?.suggestedQueries?.broad || ""),
      ...hasBadWords(out?.suggestedQueries?.exact || ""),
      ...hasBadWords(out?.suggestedQueries?.strict || ""),
    ];
    if (bad.length) badWordCount += 1;

    details.push({
      id: r.id,
      image,
      expected,
      got: {
        brand: outBrand,
        category: outCat,
        confidence: out.confidence,
        suggestedQueries: out.suggestedQueries,
      },
      checks: { brandOk, catOk, badWords: Array.from(new Set(bad)) },
    });

    process.stdout.write(`.`);
  }

  process.stdout.write("\n\n");

  const report = {
    summary: {
      brandHitRate: brandTotal ? brandHit / brandTotal : null,
      categoryHitRate: catTotal ? catHit / catTotal : null,
      strictAuthRate: strictTotal ? strictHasAuth / strictTotal : null,
      badWordRows: badWordCount,
      totals: { brandTotal, catTotal, strictTotal },
    },
    details,
  };

  fs.writeFileSync("eval/report.json", JSON.stringify(report, null, 2));

  console.log("Report written to eval/report.json");
  console.log("Summary:");
  console.log(report.summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
