export type IconicCatalogItem = {
  id: string;
  label: string; // e.g. "balenciaga city"
  brand: string;
  model: string;
  categoryHint?: string; // e.g. "top handle bag" / "shoulder bag"
};

// v1: Bags Top 20 (for fast product validation)
export const ICONIC_BAGS_TOP20: IconicCatalogItem[] = [
  { id: "hermes-birkin-30", label: "hermes birkin 30", brand: "hermes", model: "birkin 30", categoryHint: "top handle bag" },
  { id: "hermes-evelyne", label: "hermes evelyne tpm pm", brand: "hermes", model: "evelyne", categoryHint: "crossbody bag" },
  { id: "therow-margaux", label: "the row margaux", brand: "the row", model: "margaux", categoryHint: "tote bag" },
  { id: "lv-speedy-p9", label: "louis vuitton speedy p9", brand: "louis vuitton", model: "speedy p9", categoryHint: "boston bag" },
  { id: "chanel-classic-flap", label: "chanel classic flap", brand: "chanel", model: "classic flap", categoryHint: "shoulder bag" },
  { id: "miu-miu-arcadie", label: "miu miu arcadie", brand: "miu miu", model: "arcadie", categoryHint: "top handle bag" },
  { id: "miu-miu-wander", label: "miu miu wander", brand: "miu miu", model: "wander", categoryHint: "hobo bag" },
  { id: "loewe-puzzle", label: "loewe puzzle", brand: "loewe", model: "puzzle", categoryHint: "shoulder bag" },
  { id: "bottega-mini-jodie", label: "bottega veneta mini jodie", brand: "bottega veneta", model: "mini jodie", categoryHint: "shoulder bag" },
  { id: "alaia-le-teckel", label: "alaia le teckel", brand: "alaia", model: "le teckel", categoryHint: "shoulder bag" },
  { id: "prada-re-edition-2005", label: "prada re-edition 2005 nylon", brand: "prada", model: "re-edition 2005", categoryHint: "shoulder bag" },
  { id: "gucci-jackie-1961", label: "gucci jackie 1961", brand: "gucci", model: "jackie 1961", categoryHint: "shoulder bag" },
  { id: "dior-saddle", label: "dior saddle bag", brand: "dior", model: "saddle", categoryHint: "shoulder bag" },
  { id: "fendi-baguette", label: "fendi baguette", brand: "fendi", model: "baguette", categoryHint: "shoulder bag" },
  { id: "celine-triomphe", label: "celine triomphe", brand: "celine", model: "triomphe", categoryHint: "shoulder bag" },
  { id: "celine-ava", label: "celine ava", brand: "celine", model: "ava", categoryHint: "shoulder bag" },
  { id: "ysl-icare-maxi", label: "saint laurent icare maxi", brand: "saint laurent", model: "icare", categoryHint: "tote bag" },
  { id: "goyard-saint-louis-pm", label: "goyard saint louis pm", brand: "goyard", model: "saint louis pm", categoryHint: "tote bag" },
  { id: "balenciaga-city", label: "balenciaga city", brand: "balenciaga", model: "city", categoryHint: "top handle bag" },
  { id: "longchamp-le-pliage", label: "longchamp le pliage", brand: "longchamp", model: "le pliage", categoryHint: "tote bag" },
];
