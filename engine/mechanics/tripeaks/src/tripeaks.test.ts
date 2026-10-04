import { LevelSession } from "@gf/core";
import { describe, expect, it } from "vitest";
import { TRIPEAKS_BOTS, triPeaksWinRate } from "./bot";
import { TriPeaksGenParams, generateTriPeaks, withStockSize } from "./generator";
import { LAYOUTS, coverGraph } from "./layouts";
import { tripeaksMechanic as M, validateTriPeaksLevel } from "./mechanic";
import { applyAction, compile, initialState, playable, uncovered } from "./rules";
import { solveLevel } from "./solver";
import type { TriPeaksLevelData } from "./types";

const PARAMS = TriPeaksGenParams.parse({ layout: "tri", stock: [16, 23], starFractions: { two: 0.25, three: 0.5 } });

function tiny(): TriPeaksLevelData {
  // A single peak: 3 cards, peak "5s" covered by "4h" and "6d".
  return {
    rules: { wrap: true },
    layout: { name: "tiny", slots: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 1 }] },
    tableau: ["5s", "4h", "6d"],
    waste: "3c",
    stock: ["9c", "Kh", "7s"],
    reserve: ["Ad", "2d"],
    stars: { two: 1, three: 2 },
  };
}

describe("tripeaks rules", () => {
  it("derives covers from geometry", () => {
    const covers = coverGraph(LAYOUTS.tri!);
    expect(LAYOUTS.tri!.length).toBe(28);
    expect(covers.filter((c) => c.length === 0)).toHaveLength(10); // bottom row is open
    expect(covers[0]).toHaveLength(2); // a peak rests on two cards
  });

  it("plays adjacent ranks, chains streaks, and draws", () => {
    const data = tiny();
    const c = compile(data);
    let s = initialState(data);
    expect(uncovered(c, s, 0)).toBe(false);
    expect(playable(c, s)).toEqual([1]); // 4h on 3c
    expect(applyAction(c, s, { type: "play", slot: 0 }).outcome).toBe("illegal"); // covered
    expect(applyAction(c, s, { type: "play", slot: 2 }).reason).toBe("rank"); // 6 on 3
    s = applyAction(c, s, { type: "play", slot: 1 }).state; // 4h on 3c
    expect(playable(c, s)).toEqual([]); // 5s is still covered by 6d, and 6 is not next to 4
    s = applyAction(c, s, { type: "draw" }).state; // 7s, streak resets
    expect(s.streak).toBe(0);
    s = applyAction(c, s, { type: "play", slot: 2 }).state; // 6d on 7s
    s = applyAction(c, s, { type: "play", slot: 0 }).state; // 5s on 6d, now uncovered
    expect(s.streak).toBe(2);
    expect(s.score).toBe(10 + 10 + 20);
    expect(M.status(s, data)).toBe("won");
    expect(M.evaluate(s, data)).toMatchObject({ stars: 3, movesLeft: 2, movesUsed: 4 });
  });

  it("wraps King and Ace when the rule is on", () => {
    const data = { ...tiny(), waste: "Kc", tableau: ["5s", "Ah", "6d"] };
    expect(playable(compile(data), initialState(data))).toEqual([1]);
    const strict = { ...data, rules: { wrap: false } };
    expect(playable(compile(strict), initialState(strict))).toEqual([]);
  });

  it("loses when stuck, continues from the reserve, and the joker ignores rank", () => {
    const data = { ...tiny(), tableau: ["5s", "9h", "Jd"], stock: [] };
    let s = M.createState(data, { seed: "s", moveBonus: 0 });
    expect(M.status(s, data)).toBe("lost");
    expect(M.lossReason(s, data)).toBe("out_of_moves");
    s = M.addBudget(s, 1, data);
    expect(M.budget(s, data)).toEqual({ kind: "stock", left: 1, total: 0 });
    expect(M.status(s, data)).toBe("playing");
    const joker = M.autoPlace!(s, { type: "play", slot: 1 }, data);
    expect(joker.outcome).toBe("applied");
    expect(M.createState(tiny(), { seed: "s", moveBonus: 2 }).stock).toHaveLength(5);
  });

  it("validates deals", () => {
    expect(validateTriPeaksLevel(tiny())).toEqual([]);
    expect(validateTriPeaksLevel({ ...tiny(), waste: "5s" })).toEqual(["card 5s is dealt twice"]);
  });
});

describe("tripeaks generator, solver and bot", () => {
  it("generates deterministic, valid, solvable deals", () => {
    const a = generateTriPeaks({ seed: "tp-1", params: PARAMS });
    expect(generateTriPeaks({ seed: "tp-1", params: PARAMS })).toEqual(a);
    expect(validateTriPeaksLevel(a.data)).toEqual([]);
    const solution = solveLevel(a.data);
    expect(solution.solved).toBe(true);
    const c = compile(a.data);
    let s = initialState(a.data);
    for (const action of solution.actions) s = applyAction(c, s, action).state;
    expect(M.status(s, a.data)).toBe("won");
  });

  it("resizes the stock without changing the deal", () => {
    const { data, draws } = generateTriPeaks({ seed: "tp-2", params: PARAMS });
    const smaller = withStockSize(data, draws + 2, draws, { two: 0.25, three: 0.5 });
    expect(smaller.tableau).toEqual(data.tableau);
    expect(smaller.stock).toHaveLength(draws + 2);
    expect(solveLevel(smaller).solved).toBe(true);
  });

  it("skilled bots win more often", () => {
    let casual = 0;
    let expert = 0;
    for (let i = 0; i < 5; i++) {
      const { data } = generateTriPeaks({ seed: `tp-bot-${i}`, params: PARAMS });
      casual += triPeaksWinRate(data, TRIPEAKS_BOTS.casual, 40, "x");
      expert += triPeaksWinRate(data, TRIPEAKS_BOTS.expert, 40, "x");
    }
    expect(expert).toBeGreaterThan(casual);
  });

  it("runs inside a core LevelSession with replay", () => {
    const data = tiny();
    const level = {
      levelId: "t.l1", number: 1, mechanic: "tripeaks", difficulty: { tier: "easy" as const, score: 0 },
      objectives: [{ type: "clear_board" as const }], lose: { outOfMoves: true, stuck: true }, boosters: { allowed: [] }, tags: [], data,
    };
    const session = new LevelSession(M, level, data, "seed", 0);
    session.act({ type: "draw" });
    session.undo();
    session.act({ type: "play", slot: 1 });
    const replay = LevelSession.replay(M, level, data, "seed", 0, JSON.parse(JSON.stringify(session.log)));
    expect(replay.state).toEqual(session.state);
  });
});
