export type Facts = {
  itemType?: string;
  category?: string;
  brand?: string | null;
  color?: string | null;
  material?: string | null;
  pattern?: string | null;
  keyVisualCues?: string[];
  visibleText?: string[];
};

export type IconicHit = {
  id: string; // stable id, e.g. "balenciaga-city"
  label: string; // user-facing short label
  brand: string; // normalized brand token for query
  model: string; // model token for query
  score: number;
  evidence: string[];
};

function norm(s: any) {
  return String(s || "").toLowerCase();
}

function hasAny(hay: string, needles: string[]) {
  return needles.some((n) => hay.includes(n));
}

function scoreByCues(hay: string, rules: Array<{ cue: string; weight: number }>) {
  const evidence: string[] = [];
  let score = 0;
  for (const r of rules) {
    if (hay.includes(r.cue)) {
      score += r.weight;
      evidence.push(r.cue);
    }
  }
  return { score, evidence };
}

/**
 * Lightweight, expandable "Top-20 iconic models" rule engine.
 *
 * Design goals:
 * - High precision (avoid false positives)
 * - Explicit evidence (why we fired)
 * - Easy to add new models (add rule block)
 */
export function detectIconicModels(facts: Facts): IconicHit[] {
  const cues = (facts.keyVisualCues || []).map((c) => norm(c));
  const vis = (facts.visibleText || []).map((c) => norm(c));
  const hay = norm([facts.category, facts.pattern, facts.material, facts.color, ...cues, ...vis].join(" "));

  const hits: IconicHit[] = [];

  // 1) Balenciaga City (Motorcycle) bag
  {
    const { score, evidence } = scoreByCues(hay, [
      { cue: "city bag", weight: 3 },
      { cue: "motorcycle bag", weight: 3 },
      { cue: "front zip pocket", weight: 2 },
      { cue: "tassels", weight: 2 },
      { cue: "braided handles", weight: 2 },
      { cue: "giant studs", weight: 2 },
      { cue: "whipstitch", weight: 1 },
    ]);

    // Fire only with strong evidence (>=4), or explicit "city bag"/"motorcycle bag".
    const explicit = hasAny(hay, ["city bag", "motorcycle bag"]);
    if (explicit || score >= 4) {
      hits.push({
        id: "balenciaga-city",
        label: "balenciaga city",
        brand: "balenciaga",
        model: "city",
        score: explicit ? score + 2 : score,
        evidence: explicit ? ["explicit city/motorcycle", ...evidence] : evidence,
      });
    }
  }

  // 2) Alexander McQueen skull-detail heels (generic bucket, we avoid over-claiming exact model)
  {
    const { score, evidence } = scoreByCues(hay, [
      { cue: "skull", weight: 3 },
      { cue: "skull heel", weight: 3 },
      { cue: "skull buckle", weight: 3 },
      { cue: "skull hardware", weight: 3 },
    ]);
    if (score >= 3) {
      hits.push({
        id: "mcqueen-skull-heels",
        label: "alexander mcqueen skull heels",
        brand: "alexander mcqueen",
        model: "skull",
        score,
        evidence,
      });
    }
  }

  // TODO (framework): add more iconic models here.
  // Examples to add next:
  // - chanel classic flap (cc + quilt + chain strap)
  // - dior saddle (saddle shape)
  // - louis vuitton speedy (boston + monogram)
  // - prada re-edition nylon

  return hits.sort((a, b) => b.score - a.score).slice(0, 3);
}
