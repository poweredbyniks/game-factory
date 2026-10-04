import type { StoryBeat, StoryTrigger } from "@gf/schemas";

function sameTrigger(a: StoryTrigger, b: StoryTrigger): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "level_complete" && b.type === "level_complete") return a.level === b.level;
  if (a.type !== "level_complete" && b.type !== "level_complete") return a.chapter === b.chapter;
  return false;
}

/** Unseen beats for a trigger, in authoring order. */
export function beatsForTrigger(beats: readonly StoryBeat[], trigger: StoryTrigger, seen: readonly string[]): StoryBeat[] {
  return beats.filter((b) => sameTrigger(b.trigger, trigger) && !seen.includes(b.id));
}
