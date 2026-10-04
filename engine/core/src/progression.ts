import type { ChapterDefinition, LevelDefinition, ProgressionDefinition } from "@gf/schemas";

export type CompletedLevel = { stars: number; bestMovesLeft: number; completedAt: number };
export type ProgressState = { frontier: number; completed: Record<string, CompletedLevel> };
export type LevelNodeState = "locked" | "available" | "completed";

export function initialProgress(): ProgressState {
  return { frontier: 1, completed: {} };
}

export function chapterForLevel(progression: ProgressionDefinition, number: number): ChapterDefinition | undefined {
  return progression.chapters.find((c) => number >= c.levels.from && number <= c.levels.to);
}

export function totalStars(progress: ProgressState): number {
  return Object.values(progress.completed).reduce((sum, c) => sum + c.stars, 0);
}

export function chapterCompleted(chapter: ChapterDefinition, progress: ProgressState): boolean {
  return progress.frontier > chapter.levels.to;
}

export function chapterUnlocked(
  progression: ProgressionDefinition,
  chapter: ChapterDefinition,
  progress: ProgressState,
): boolean {
  const index = progression.chapters.indexOf(chapter);
  const previous = index > 0 ? progression.chapters[index - 1] : undefined;
  const previousDone = !previous || chapterCompleted(previous, progress);
  if (chapter.unlock.type === "previous_chapter") return previousDone;
  return previousDone && totalStars(progress) >= chapter.unlock.stars;
}

export function nodeState(
  progression: ProgressionDefinition,
  progress: ProgressState,
  number: number,
): LevelNodeState {
  if (number < progress.frontier) return "completed";
  if (number > progress.frontier) return "locked";
  const chapter = chapterForLevel(progression, number);
  if (chapter && !chapterUnlocked(progression, chapter, progress)) return "locked";
  return "available";
}

export type PlayCheck = { ok: true } | { ok: false; reason: "locked" | "completed" | "gated" | "unknown_level" };

export function canPlay(
  progression: ProgressionDefinition,
  levels: readonly LevelDefinition[],
  progress: ProgressState,
  number: number,
): PlayCheck {
  if (!levels.some((l) => l.number === number)) return { ok: false, reason: "unknown_level" };
  if (number < progress.frontier) return progression.replayCompleted ? { ok: true } : { ok: false, reason: "completed" };
  if (number > progress.frontier) return { ok: false, reason: "locked" };
  const chapter = chapterForLevel(progression, number);
  if (chapter && !chapterUnlocked(progression, chapter, progress)) return { ok: false, reason: "gated" };
  return { ok: true };
}

export type WinOutcome = { firstWin: boolean; chapterCompleted: ChapterDefinition | null; newFrontier: number };

/** Records a win. Mutates progress. Linear unlock: the frontier moves to the next level. */
export function applyWin(
  progression: ProgressionDefinition,
  progress: ProgressState,
  level: LevelDefinition,
  stars: number,
  movesLeft: number,
  now: number,
): WinOutcome {
  const previous = progress.completed[level.levelId];
  const firstWin = !previous;
  progress.completed[level.levelId] = {
    stars: Math.max(stars, previous?.stars ?? 0),
    bestMovesLeft: Math.max(movesLeft, previous?.bestMovesLeft ?? 0),
    completedAt: previous?.completedAt ?? now,
  };
  let chapterDone: ChapterDefinition | null = null;
  if (level.number === progress.frontier) {
    progress.frontier = level.number + 1;
    const chapter = chapterForLevel(progression, level.number);
    if (chapter && chapter.levels.to === level.number) chapterDone = chapter;
  }
  return { firstWin, chapterCompleted: chapterDone, newFrontier: progress.frontier };
}
