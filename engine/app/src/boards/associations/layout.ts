import { compile, type AssociationLevelData, type AssociationState } from "@gf/mechanic-associations";

export type Metrics = {
  width: number;
  height: number;
  pad: number;
  gap: number;
  cardW: number;
  cardH: number;
  topY: number;
  tableauY: number;
  slotX: number[];
  wasteX: number;
  stockX: number;
  colX: number[];
  downOffset: number;
  upOffset: number;
};

export type Placement = {
  index: number;
  x: number;
  y: number;
  z: number;
  faceUp: boolean;
  visible: boolean;
  where: "column" | "stock" | "waste" | "slot" | "slot-under" | "done";
  column?: number;
  slot?: number;
  depth: number;
};

export function computeMetrics(width: number, height: number, data: AssociationLevelData, state: AssociationState, aspect: number): Metrics {
  const pad = 10;
  const gap = width < 360 ? 6 : 8;
  const columns = state.cols.length;
  const slots = state.slots.length;
  const n = Math.max(columns, slots + 2);
  const cardW = Math.max(40, Math.min(92, Math.floor((width - 2 * pad - (n - 1) * gap) / n)));
  const cardH = Math.round(cardW * aspect);
  const topY = 6;
  const tableauY = topY + cardH + 22;
  const slotX = Array.from({ length: slots }, (_, i) => pad + i * (cardW + gap));
  const stockX = width - pad - cardW;
  const wasteX = stockX - gap - cardW;
  const total = columns * cardW + (columns - 1) * gap;
  const start = (width - total) / 2;
  const colX = Array.from({ length: columns }, (_, i) => start + i * (cardW + gap));
  let downOffset = cardH * 0.16;
  let upOffset = cardH * 0.36;
  const available = height - tableauY - pad;
  const tallest = Math.max(
    1,
    ...state.cols.map((c) => c.down * downOffset + Math.max(0, c.cards.length - 1 - c.down) * upOffset),
    // Leave room for runs that grow during play.
    data.categories.reduce((m, c) => Math.max(m, c.size), 0) * upOffset,
  );
  if (tallest + cardH > available) {
    const scale = Math.max(0.42, (available - cardH) / tallest);
    downOffset *= scale;
    upOffset *= scale;
  }
  return { width, height, pad, gap, cardW, cardH, topY, tableauY, slotX, wasteX, stockX, colX, downOffset, upOffset };
}

/** Where every card of the level is, for the current state. Cards never unmount, so moves animate. */
export function layoutCards(data: AssociationLevelData, state: AssociationState, m: Metrics): Placement[] {
  const lvl = compile(data);
  const out: Placement[] = new Array(lvl.total);
  const placed = new Uint8Array(lvl.total);
  const put = (p: Placement) => {
    out[p.index] = p;
    placed[p.index] = 1;
  };
  state.cols.forEach((col, c) => {
    let y = m.tableauY;
    col.cards.forEach((index, depth) => {
      put({ index, x: m.colX[c]!, y, z: 20 + depth, faceUp: depth >= col.down, visible: true, where: "column", column: c, depth });
      y += depth < col.down ? m.downOffset : m.upOffset;
    });
  });
  state.stock.forEach((index, depth) => {
    put({ index, x: m.stockX, y: m.topY - Math.min(depth, 3) * 0.6, z: 2 + depth, faceUp: false, visible: depth >= state.stock.length - 3, where: "stock", depth });
  });
  state.waste.forEach((index, depth) => {
    put({ index, x: m.wasteX, y: m.topY, z: 100 + depth, faceUp: true, visible: depth >= state.waste.length - 2, where: "waste", depth });
  });
  state.slots.forEach((slot, s) => {
    if (!slot) return;
    put({ index: lvl.catCard[slot.cat]!, x: m.slotX[s]!, y: m.topY, z: 320, faceUp: true, visible: true, where: "slot", slot: s, depth: 0 });
  });
  for (let index = 0; index < lvl.total; index++) {
    if (placed[index]) continue;
    const cat = lvl.catOf[index]!;
    const s = state.slots.findIndex((slot) => slot?.cat === cat);
    if (s >= 0) {
      out[index] = { index, x: m.slotX[s]!, y: m.topY, z: 300, faceUp: true, visible: true, where: "slot-under", slot: s, depth: 0 };
    } else {
      out[index] = { index, x: m.width / 2 - m.cardW / 2, y: -m.cardH * 1.6, z: 400, faceUp: true, visible: false, where: "done", depth: 0 };
    }
  }
  return out;
}

/** Font size so the longest word of a label fits the card width. */
export function wordFontSize(label: string, cardW: number): number {
  const longest = label.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 1);
  return Math.max(8, Math.min(15, Math.floor((cardW - 8) / (longest * 0.6))));
}
