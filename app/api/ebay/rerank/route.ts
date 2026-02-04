import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function normalizeSpaces(s: string) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embedText(client: OpenAI, text: string): Promise<number[]> {
  const resp = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return (resp.data?.[0] as any)?.embedding ?? [];
}

async function describeImage(client: OpenAI, args: { dataUrl?: string; imageUrl?: string }) {
  const prompt =
    "Describe the PRIMARY fashion item in the image for second-hand search. " +
    "Be concise. Output a single line with: brand(if visible) | item type | material | color | shape cues | logo cues. " +
    "Do NOT add extra brands. No punctuation besides pipes.";

  const content: any[] = [{ type: "input_text", text: prompt }];
  if (args.dataUrl) content.push({ type: "input_image", image_url: args.dataUrl });
  else if (args.imageUrl) content.push({ type: "input_image", image_url: args.imageUrl });

  const resp = await client.responses.create({
    model: "gpt-4.1-mini",
    input: [{ role: "user", content } as any],
  });

  return normalizeSpaces(resp.output_text || "");
}

async function fetchEbayItems(q: string, limit: number) {
  const url = new URL(process.env.NEXT_PUBLIC_BASE_URL ? `${process.env.NEXT_PUBLIC_BASE_URL}/api/ebay/browse` : "http://localhost:3000/api/ebay/browse");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), { cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || "eBay browse failed");
  return Array.isArray(json.items) ? json.items : [];
}

export async function POST(req: Request) {
  const client = getOpenAIClient();
  if (!client) return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });

  const form = await req.formData();
  const file = form.get("image");
  const queriesRaw = String(form.get("queries") || "");

  const queries = queriesRaw
    .split("\n")
    .map((s) => normalizeSpaces(s))
    .filter(Boolean)
    .slice(0, 12);

  if (!(file instanceof File)) return NextResponse.json({ error: "No image" }, { status: 400 });
  if (queries.length === 0) return NextResponse.json({ error: "No queries" }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "image/jpeg";
  const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;

  // Describe + embed the uploaded image
  const qDesc = await describeImage(client, { dataUrl });
  const qEmb = await embedText(client, qDesc);

  // Evaluate each query by how many similar items appear in top results.
  const scored: any[] = [];

  for (const q of queries) {
    const items = await fetchEbayItems(q, 30);
    const top = items.slice(0, 18);

    // Describe each item image (limited)
    const descs: string[] = [];
    for (const it of top) {
      const d = await describeImage(client, { imageUrl: it.imageUrl });
      descs.push(d);
    }

    const embs = await Promise.all(descs.map((d) => embedText(client, d)));
    const sims = embs.map((e) => cosine(qEmb, e));
    const simsSorted = [...sims].sort((a, b) => b - a);

    const top10 = simsSorted.slice(0, 10);
    const score = top10.reduce((a, b) => a + b, 0);

    scored.push({ q, score, top10, items: top, sims });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  // Build reranked list for best query
  const paired = best.items.map((it: any, i: number) => ({ ...it, sim: best.sims[i] ?? 0 }));
  paired.sort((a: any, b: any) => b.sim - a.sim);

  return NextResponse.json({
    imageDescriptor: qDesc,
    bestQuery: best.q,
    candidates: scored.map((x) => ({ q: x.q, score: x.score, top10: x.top10 })),
    ebay: paired.slice(0, 18),
  });
}
