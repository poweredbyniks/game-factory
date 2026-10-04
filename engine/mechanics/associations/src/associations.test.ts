import { LevelSession, createRng } from "@gf/core";
import { describe, expect, it } from "vitest";
import { BOT_PROFILES, estimateWinRate, playBot } from "./bot";
import { compile } from "./compiled";
import { AssociationGenParams, generateLevel, type PoolCategory } from "./generator";
import { associationsMechanic as M, validateAssociationLevel } from "./mechanic";
import { applyAction, countCards, initialState, isStuck, legalActions } from "./rules";
import { solveLevel } from "./solver";
import { DEFAULT_RULES, type AssociationAction, type AssociationLevelData, type AssociationState } from "./types";

const card = (id: string) => {
  const [kind, category] = id.split(".");
  return kind === "c" ? { id, kind: "category" as const, category: category! } : { id, kind: "word" as const, category: category!, word: id.slice(2) };
};

/** Two categories of two words, one slot. */
function tinyLevel(over: Partial<AssociationLevelData> = {}): AssociationLevelData {
  const ids = ["c.a", "w.a.one", "w.a.two", "c.b", "w.b.one", "w.b.two"];
  return {
    rules: { ...DEFAULT_RULES, foundationSlots: 1 },
    categories: [{ id: "a", size: 2 }, { id: "b", size: 2 }],
    cards: ids.map(card),
    tableau: [
      { cards: ["w.b.one", "c.a"], faceDown: 1 },
      { cards: ["w.a.one"], faceDown: 0 },
      { cards: ["w.b.two", "w.a.two"], faceDown: 0 },
    ],
    stock: ["c.b"],
    moves: 20,
    stars: { two: 5, three: 10 },
    ...over,
  };
}

const col = (index: number) => ({ pile: "column", index }) as const;
const slot = (index: number) => ({ pile: "slot", index }) as const;
const move = (from: AssociationAction extends infer A ? A extends { from: infer F } ? F : never : never, to: ReturnType<typeof slot> | ReturnType<typeof col>): AssociationAction => ({ type: "move", from, to });

describe("associations rules", () => {
  it("plays a level from deal to win", () => {
    const data = tinyLevel();
    const lvl = compile(data);
    let s = initialState(data);
    const step = (action: AssociationAction, expected: "applied" | "mismatch" | "illegal") => {
      const r = applyAction(lvl, s, action);
      expect(r.outcome, JSON.stringify(action)).toBe(expected);
      if (expected === "illegal") expect(r.state).toBe(s);
      expect(countCards(lvl, r.state)).toBe(lvl.total);
      s = r.state;
      return r;
    };
    step(move(col(1), slot(0)), "illegal"); // an empty slot needs a category card
    expect(s.movesLeft).toBe(20);
    const opened = step(move(col(0), slot(0)), "applied");
    expect(opened.events.map((e) => e.type)).toEqual(["moved", "revealed", "category_placed"]);
    expect(s.cols[0]).toEqual({ cards: [lvl.cardIndex.get("w.b.one")], down: 0 });
    step(move(col(1), slot(0)), "applied");
    const done = step(move(col(2), slot(0)), "applied");
    expect(done.events.at(-1)).toEqual({ type: "category_completed", category: "a" });
    expect(s.slots).toEqual([null]);
    step({ type: "draw" }, "applied");
    step(move({ pile: "waste" }, slot(0)), "applied");
    step(move(col(0), col(2)), "applied"); // b onto b: a run of two
    step(move(col(2), slot(0)), "applied"); // the whole run at once
    expect(M.status(s, data)).toBe("won");
    expect(s.movesUsed).toBe(7);
    expect(M.evaluate(s, data)).toMatchObject({ stars: 3, movesLeft: 13 });
  });

  it("charges mismatches and leaves the cards in place", () => {
    const data = tinyLevel();
    const lvl = compile(data);
    let s = applyAction(lvl, initialState(data), move(col(0), slot(0))).state; // open "a"
    const r = applyAction(lvl, s, move(col(0), slot(0))); // "b" word onto "a"
    expect(r.outcome).toBe("mismatch");
    expect(r.state.movesLeft).toBe(s.movesLeft - 1);
    expect(r.state.mismatches).toBe(1);
    expect(r.state.cols).toBe(s.cols);
    s = r.state;
    expect(applyAction(lvl, s, move(col(1), col(0))).outcome).toBe("mismatch"); // "a" word onto "b" word
    const free = tinyLevel({ rules: { ...DEFAULT_RULES, foundationSlots: 1, mismatchCostsMove: false } });
    const s2 = applyAction(compile(free), initialState(free), move(col(0), slot(0))).state;
    expect(applyAction(compile(free), s2, move(col(0), slot(0))).state.movesLeft).toBe(s2.movesLeft);
  });

  it("enforces stacking and empty-column rules", () => {
    const data = tinyLevel();
    const lvl = compile(data);
    const s = initialState(data);
    expect(applyAction(lvl, s, move(col(1), col(0))).outcome).toBe("illegal"); // nothing stacks on a category card
    expect(applyAction(lvl, s, move(col(0), col(1))).outcome).toBe("illegal"); // category card onto a word
    const strict = tinyLevel({ rules: { ...DEFAULT_RULES, foundationSlots: 1, emptyColumn: "category_only" } });
    const sl = compile(strict);
    let t = applyAction(sl, initialState(strict), move(col(0), slot(0))).state;
    t = applyAction(sl, t, move(col(1), slot(0))).state; // column 1 is now empty
    expect(applyAction(sl, t, move(col(2), col(1))).outcome).toBe("illegal");
  });

  it("draws, recycles within the limit, and runs out of moves", () => {
    const data = tinyLevel({ rules: { ...DEFAULT_RULES, foundationSlots: 1, recycleLimit: 1 }, moves: 4 });
    const lvl = compile(data);
    let s = initialState(data);
    s = applyAction(lvl, s, { type: "draw" }).state;
    s = applyAction(lvl, s, { type: "draw" }).state; // recycle 1
    s = applyAction(lvl, s, { type: "draw" }).state;
    expect(applyAction(lvl, s, { type: "draw" }).outcome).toBe("illegal"); // limit reached
    s = applyAction(lvl, s, move(col(1), col(2))).state; // "a" word onto "a" word
    expect(s.movesLeft).toBe(0);
    expect(M.status(s, data)).toBe("lost");
    expect(M.lossReason(s, data)).toBe("out_of_moves");
    expect(applyAction(lvl, s, { type: "draw" }).outcome).toBe("illegal");
  });

  it("detects a stuck board", () => {
    // No stacking and no empty columns, so only slots can take cards.
    const data = tinyLevel({ rules: { ...DEFAULT_RULES, foundationSlots: 1, wordOnWord: "never", emptyColumn: "none" } });
    const lvl = compile(data);
    const i = (id: string) => lvl.cardIndex.get(id)!;
    const board: AssociationState = {
      cols: [
        { cards: [i("w.b.one"), i("w.a.one")], down: 1 },
        { cards: [i("c.a")], down: 0 },
        { cards: [i("w.b.two"), i("w.a.two")], down: 1 },
      ],
      stock: [], waste: [], slots: [null], done: [], movesLeft: 9, movesUsed: 0, mismatches: 0, recycles: 0,
    };
    expect(isStuck(lvl, board)).toBe(false); // c.a can open the free slot
    const blocked: AssociationState = { ...board, slots: [{ cat: 1, placed: 0 }] }; // "b" holds the only slot
    expect(legalActions(lvl, blocked)).toEqual([]);
    expect(M.status(blocked, data)).toBe("lost");
    expect(M.lossReason(blocked, data)).toBe("stuck");
  });

  it("validates level structure", () => {
    expect(validateAssociationLevel(tinyLevel())).toEqual([]);
    const broken = tinyLevel({
      categories: [{ id: "a", size: 3 }, { id: "b", size: 2 }],
      tableau: [{ cards: ["w.b.one", "c.a"], faceDown: 2 }, { cards: ["w.a.one", "w.a.one"], faceDown: 0 }],
    });
    expect(validateAssociationLevel(broken)).toEqual([
      'category "a" declares size 3 but has 2 words',
      'card "w.a.one" is dealt twice',
      'card "w.a.two" is never dealt',
      'card "w.b.two" is never dealt',
      "column 0: the top card must be face up",
    ]);
  });
});

const POOL: PoolCategory[] = [
  ["fruits", 1, "Apple Banana Cherry Mango Pear Plum Grape Lemon"],
  ["colors", 1, "Red Blue Green Yellow Purple Orange Pink Brown"],
  ["animals", 1, "Lion Tiger Zebra Horse Rabbit Monkey Camel Panda"],
  ["tools", 2, "Hammer Wrench Saw Drill Pliers Chisel Ruler Shovel"],
  ["planets", 2, "Mars Venus Saturn Jupiter Mercury Neptune Uranus Earth"],
  ["music", 2, "Piano Guitar Violin Drums Flute Harp Cello Trumpet"],
  ["weather", 3, "Rain Snow Fog Hail Storm Breeze Thunder Drizzle"],
  ["kitchen", 3, "Whisk Ladle Kettle Toaster Spatula Grater Colander Oven"],
  ["sports", 2, "Tennis Soccer Hockey Golf Rugby Boxing Cricket Rowing"],
  ["trees", 3, "Oak Maple Birch Willow Cedar Pine Elm Aspen"],
  ["shapes", 1, "Circle Square Oval Cube Sphere Cone Prism Star"],
  ["jobs", 2, "Baker Pilot Nurse Farmer Tailor Judge Miner Chef"],
].map(([id, difficulty, words]) => ({ id: id as string, difficulty: difficulty as number, words: (words as string).split(" ") }));

const PARAMS = AssociationGenParams.parse({
  categories: [3, 4],
  wordsPerCategory: [3, 5],
  columns: 4,
  columnHeight: [3, 4],
  faceDown: [1, 2],
  categoryDifficulty: [1, 3],
  moveSlack: { factor: 1.5, flat: 4 },
  starFractions: { two: 0.25, three: 0.5 },
  rules: { foundationSlots: 2 },
});

describe("generator and solver", () => {
  it("is deterministic per seed and produces valid, solvable levels", () => {
    const a = generateLevel({ seed: "lvl-1", params: PARAMS, pool: POOL });
    const b = generateLevel({ seed: "lvl-1", params: PARAMS, pool: POOL });
    const c = generateLevel({ seed: "lvl-2", params: PARAMS, pool: POOL });
    expect(a).toEqual(b);
    expect(c.data).not.toEqual(a.data);
    for (const level of [a, c]) {
      expect(validateAssociationLevel(level.data)).toEqual([]);
      expect(level.data.rules.foundationSlots).toBe(2);
      expect(level.data.moves).toBe(Math.ceil(level.analysis.solutionLength * 1.5 + 4));
      expect(level.data.stars.three).toBeGreaterThan(level.data.stars.two);
      const tops = level.data.tableau.map((t) => t.cards.at(-1)!);
      expect(tops.some((id) => id.startsWith("c."))).toBe(true);
    }
  });

  it("solutions replay to a win within the budget", () => {
    for (let i = 0; i < 8; i++) {
      const { data } = generateLevel({ seed: `replay-${i}`, params: PARAMS, pool: POOL });
      const solution = solveLevel(data);
      expect(solution.solved).toBe(true);
      const lvl = compile(data);
      let s = initialState(data);
      for (const action of solution.actions) {
        const r = applyAction(lvl, s, action);
        expect(r.outcome).toBe("applied");
        s = r.state;
      }
      expect(M.status(s, data)).toBe("won");
      expect(s.movesUsed).toBeLessThanOrEqual(data.moves);
    }
  });

  it("avoids recently used categories when it can", () => {
    const first = generateLevel({ seed: "avoid", params: PARAMS, pool: POOL });
    const second = generateLevel({ seed: "avoid-2", params: PARAMS, pool: POOL, avoid: new Set(first.categories) });
    expect(second.categories.filter((id) => first.categories.includes(id))).toEqual([]);
  });
});

describe("random play invariants", () => {
  it("never loses or duplicates a card and never changes state on illegal moves", () => {
    for (let level = 0; level < 6; level++) {
      const { data } = generateLevel({ seed: `prop-${level}`, params: PARAMS, pool: POOL });
      const lvl = compile(data);
      const rng = createRng(`play-${level}`);
      let s = initialState(data, 30);
      for (let step = 0; step < 300 && M.status(s, data) === "playing"; step++) {
        const legal = legalActions(lvl, s);
        const randomMove: AssociationAction = {
          type: "move",
          from: rng.chance(0.2) ? { pile: "waste" } : { pile: "column", index: rng.int(s.cols.length) },
          to: rng.chance(0.5) ? { pile: "slot", index: rng.int(s.slots.length) } : { pile: "column", index: rng.int(s.cols.length) },
        };
        const action = legal.length > 0 && rng.chance(0.7) ? rng.pick(legal) : randomMove;
        const r = applyAction(lvl, s, action);
        if (r.outcome === "illegal") expect(r.state).toBe(s);
        expect(countCards(lvl, r.state)).toBe(lvl.total);
        for (const c of r.state.cols) if (c.cards.length > 0) expect(c.down).toBeLessThan(c.cards.length);
        s = r.state;
      }
    }
  });
});

describe("bot and boosters", () => {
  it("better knowledge wins more often", () => {
    let casual = 0;
    let expert = 0;
    for (let i = 0; i < 6; i++) {
      const { data } = generateLevel({ seed: `bot-${i}`, params: { ...PARAMS, moveSlack: { factor: 1.25, flat: 2 } }, pool: POOL });
      casual += estimateWinRate(data, BOT_PROFILES.casual, 30, "t");
      expert += estimateWinRate(data, BOT_PROFILES.expert, 30, "t");
    }
    expect(expert).toBeGreaterThan(casual);
    expect(expert / 6).toBeGreaterThan(0.5);
  });

  it("a bot run is reproducible from its seed", () => {
    const { data } = generateLevel({ seed: "bot-repro", params: PARAMS, pool: POOL });
    expect(playBot(data, BOT_PROFILES.average, "x")).toEqual(playBot(data, BOT_PROFILES.average, "x"));
  });

  it("hints point at applied moves and the joker places for free", () => {
    const data = tinyLevel();
    const s = M.createState(data, { seed: "s", moveBonus: 0 });
    const hint = M.hint(s, data)!;
    expect(M.apply(s, hint, data).outcome).toBe("applied");
    const opened = M.apply(s, move(col(0), slot(0)), data).state;
    const joker = M.autoPlace!(opened, move(col(1), col(0)), data);
    expect(joker.outcome).toBe("applied");
    expect(joker.state.movesLeft).toBe(opened.movesLeft);
    expect(joker.state.slots[0]).toEqual({ cat: 0, placed: 1 });
    expect(M.autoPlace!(opened, move(col(0), col(1)), data).outcome).toBe("illegal"); // "b" is not open yet
  });

  it("works inside a core LevelSession with undo and replay", () => {
    const data = tinyLevel();
    const level = {
      levelId: "x.l1", number: 1, mechanic: "associations", difficulty: { tier: "easy" as const, score: 0 },
      objectives: [{ type: "clear_board" as const }], lose: { outOfMoves: true, stuck: true }, boosters: { allowed: [] }, tags: [], data,
    };
    const session = new LevelSession(M, level, data, "seed", 2);
    session.act(move(col(0), slot(0)));
    session.act(move(col(0), slot(0))); // mismatch
    session.undo();
    session.act({ type: "draw" });
    const replayed = LevelSession.replay(M, level, data, "seed", 2, JSON.parse(JSON.stringify(session.log)));
    expect(replayed.state).toEqual(session.state);
    expect(session.budget()).toEqual({ kind: "moves", left: 20, total: 20 });
    expect(M.isAction({ type: "move", from: { pile: "column", index: 1 }, to: { pile: "slot", index: 0 } })).toBe(true);
    expect(M.isAction({ type: "move", from: { pile: "deck" }, to: { pile: "slot", index: 0 } })).toBe(false);
  });
});
