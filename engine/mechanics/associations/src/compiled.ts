import type { AssociationLevelData } from "./types";

/** Index-based lookup tables for one level, computed once and cached per data object. */
export type CompiledLevel = {
  data: AssociationLevelData;
  /** Category index per card. */
  catOf: Int16Array;
  /** 1 when the card is a category card. */
  isCat: Uint8Array;
  /** Word count per category index. */
  size: Int16Array;
  /** Category card index per category index. */
  catCard: Int16Array;
  cardIndex: Map<string, number>;
  categoryIndex: Map<string, number>;
  total: number;
};

const cache = new WeakMap<AssociationLevelData, CompiledLevel>();

export function compile(data: AssociationLevelData): CompiledLevel {
  const hit = cache.get(data);
  if (hit) return hit;
  const categoryIndex = new Map(data.categories.map((c, i) => [c.id, i] as const));
  const cardIndex = new Map(data.cards.map((c, i) => [c.id, i] as const));
  const catOf = new Int16Array(data.cards.length);
  const isCat = new Uint8Array(data.cards.length);
  const catCard = new Int16Array(data.categories.length).fill(-1);
  data.cards.forEach((card, i) => {
    const cat = categoryIndex.get(card.category) ?? -1;
    catOf[i] = cat;
    if (card.kind === "category") {
      isCat[i] = 1;
      if (cat >= 0) catCard[cat] = i;
    }
  });
  const size = Int16Array.from(data.categories.map((c) => c.size));
  const compiled: CompiledLevel = { data, catOf, isCat, size, catCard, cardIndex, categoryIndex, total: data.cards.length };
  cache.set(data, compiled);
  return compiled;
}
