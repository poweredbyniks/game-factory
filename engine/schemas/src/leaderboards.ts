import { z } from "zod";
import { Id, LocKey, SchemaVersion } from "./common";

export const LEADERBOARD_METRICS = ["stars_total", "stars_earned", "levels_completed", "event_points"] as const;
export const LEADERBOARD_PERIODS = ["all_time", "weekly", "daily", "event"] as const;

/** One server-side leaderboard. Values come only from attempts the server replayed and accepted. */
export const LeaderboardDefinition = z.strictObject({
  id: Id,
  titleKey: LocKey,
  metric: z
    .enum(LEADERBOARD_METRICS)
    .describe("stars_total and levels_completed are all-time progress; stars_earned counts new stars in the period"),
  period: z.enum(LEADERBOARD_PERIODS),
  size: z.int().min(10).max(1000).default(100).describe("Entries shown"),
  minLevel: z.int().positive().default(1).describe("Players appear once they completed this level"),
  event: Id.optional().describe("LiveOps event id, for event_points boards"),
});
export type LeaderboardDefinition = z.infer<typeof LeaderboardDefinition>;

export const LeaderboardsFile = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: SchemaVersion,
    boards: z.array(LeaderboardDefinition),
  })
  .meta({ title: "LeaderboardsFile", description: "leaderboards.json: template defaults, overridden per game" });
export type LeaderboardsFile = z.infer<typeof LeaderboardsFile>;
