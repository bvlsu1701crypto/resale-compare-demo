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

function asArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

function hitAnyToken(haystack, expected) {
  const hs = norm(haystack);
  const exp = asArray(expected)
    .map((x) => norm(x))
    .filter(Boolean);
  if (!exp.length) return null;
  return exp.some((t) => hs.includes(t));
}

function hitLooseField(gotValue, expectedValue) {
  const exp = asArray(expectedValue).filter((x) => x != null);
  if (!exp.length) return null;
  const gv = gotValue;
  return exp.some((e) => containsLoose(gv, e));
}

async function main() {
  const rows = readJsonl(datasetPath);

  let brandTotal = 0,
    brandHit = 0;
  let catTotal = 0,
    catHit = 0;

  let materialTotal = 0,
    materialHit = 0;
  let colorTotal = 0,
    colorHit = 0;
  let patternTotal = 0,
    patternHit = 0;
  let silhouetteTotal = 0,
    silhouetteHit = 0;

  let mustIncTotal = 0,
    mustIncHitBroad = 0,
    mustIncHitExact = 0,
    mustIncHitStrict = 0;

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
    const expMaterial = expected.material ?? null;
    const expColor = expected.color ?? null;
    const expPattern = expected.pattern ?? null;
    const expSilhouette = expected.silhouette ?? null;
    const expMustInclude = expected.mustInclude ?? null;

    const outBrand = out.brand ?? null;
    const outCat = out.category ?? null;
    const outMaterial = out.material ?? null;
    const outPattern = out.pattern ?? null;

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
      const structuredOk = hitLooseField(outCat, expCat);
      const queryOk = hitAnyToken(qBroad, expCat);
      catOk = Boolean(structuredOk || queryOk);
      if (catOk) catHit++;
    }

    // Material / Color / Pattern / Silhouette (fine-grained)
    let materialOk = null;
    if (expMaterial != null) {
      materialTotal++;
      materialOk = Boolean(hitAnyToken(`${outMaterial} ${allQ}`, expMaterial));
      if (materialOk) materialHit++;
    }

    let colorOk = null;
    if (expColor != null) {
      colorTotal++;
      colorOk = Boolean(hitAnyToken(allQ, expColor));
      if (colorOk) colorHit++;
    }

    let patternOk = null;
    if (expPattern != null) {
      patternTotal++;
      patternOk = Boolean(hitAnyToken(`${outPattern} ${allQ}`, expPattern));
      if (patternOk) patternHit++;
    }

    let silhouetteOk = null;
    if (expSilhouette != null) {
      silhouetteTotal++;
      const cues = Array.isArray(out?.keyVisualCues) ? out.keyVisualCues.join(" ") : "";
      silhouetteOk = Boolean(hitAnyToken(`${cues} ${allQ}`, expSilhouette));
      if (silhouetteOk) silhouetteHit++;
    }

    // mustInclude: require ALL tokens to appear (in each query type)
    let mustIncludeOkBroad = null;
    let mustIncludeOkExact = null;
    let mustIncludeOkStrict = null;
    if (expMustInclude != null) {
      const tokens = asArray(expMustInclude).map((x) => norm(x)).filter(Boolean);
      if (tokens.length) {
        mustIncTotal++;
        const hb = norm(qBroad);
        const he = norm(qExact);
        const hs = norm(qStrict);
        mustIncludeOkBroad = tokens.every((t) => hb.includes(t));
        mustIncludeOkExact = tokens.every((t) => he.includes(t));
        mustIncludeOkStrict = tokens.every((t) => hs.includes(t));
        if (mustIncludeOkBroad) mustIncHitBroad++;
        if (mustIncludeOkExact) mustIncHitExact++;
        if (mustIncludeOkStrict) mustIncHitStrict++;
      }
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
        material: outMaterial,
        pattern: outPattern,
        suggestedQueries: out.suggestedQueries,
      },
      checks: {
        brandOk,
        catOk,
        materialOk,
        colorOk,
        patternOk,
        silhouetteOk,
        mustIncludeOkBroad,
        mustIncludeOkExact,
        mustIncludeOkStrict,
        badWords: Array.from(new Set(bad)),
      },
    });

    process.stdout.write(`.`);
  }

  process.stdout.write("\n\n");

  const report = {
    summary: {
      brandHitRate: brandTotal ? brandHit / brandTotal : null,
      categoryHitRate: catTotal ? catHit / catTotal : null,

      materialHitRate: materialTotal ? materialHit / materialTotal : null,
      colorHitRate: colorTotal ? colorHit / colorTotal : null,
      patternHitRate: patternTotal ? patternHit / patternTotal : null,
      silhouetteHitRate: silhouetteTotal ? silhouetteHit / silhouetteTotal : null,

      mustIncludeHitRateBroad: mustIncTotal ? mustIncHitBroad / mustIncTotal : null,
      mustIncludeHitRateExact: mustIncTotal ? mustIncHitExact / mustIncTotal : null,
      mustIncludeHitRateStrict: mustIncTotal ? mustIncHitStrict / mustIncTotal : null,

      strictAuthRate: strictTotal ? strictHasAuth / strictTotal : null,
      badWordRows: badWordCount,
      totals: {
        brandTotal,
        catTotal,
        materialTotal,
        colorTotal,
        patternTotal,
        silhouetteTotal,
        mustIncTotal,
        strictTotal,
      },
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
