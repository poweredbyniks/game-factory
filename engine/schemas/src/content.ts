import { z } from "zod";
import { Id, SchemaVersion } from "./common";

export const WordCategory = z.strictObject({
  id: Id,
  name: z.string().min(1).max(18).describe("Shown on the category card"),
  difficulty: z.int().min(1).max(5).describe("1 concrete and everyday ... 5 lateral thinking"),
  tags: z.array(z.string()).default([]),
  words: z.array(z.string().min(1).max(12)).min(4).describe("Each word belongs to this category only"),
});
export type WordCategory = z.infer<typeof WordCategory>;

export const WordPack = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: SchemaVersion,
    packId: Id,
    locale: z.string().min(2),
    title: z.string(),
    categories: z.array(WordCategory).min(1),
  })
  .meta({ title: "WordPack", description: "content/word-packs/LOCALE/ID.json: categories and words" });
export type WordPack = z.infer<typeof WordPack>;

/** Stable word id derived from category id and the word text: "fruits.green_apple". */
export function wordId(categoryId: string, word: string): string {
  const slug = word
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${categoryId}.${slug || "w"}`;
}

export const categoryLabelKey = (categoryId: string) => `content.cat.${categoryId}`;
export const wordLabelKey = (id: string) => `content.word.${id}`;
