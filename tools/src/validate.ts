import { placeholdersOf, storeSku, type GameBundle, type ItemBag, type ReleaseDefinition, type TemplateDefinition } from "@gf/schemas";
import type { Issues } from "./issues";

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) (seen.has(v) ? dup : seen).add(v);
  return [...dup];
}

/** Cross-reference and consistency checks over a schema-valid bundle. */
export function crossValidate(bundle: GameBundle, template: TemplateDefinition, issues: Issues): void {
  const { economy, progression, store, monetization, theme } = bundle;
  const items = new Map(economy.items.map((i) => [i.id, i]));
  const usedKeys = new Map<string, string>(); // key -> where
  const key = (k: string | undefined, where: string) => {
    if (k) usedKeys.set(k, where);
  };
  const bag = (b: ItemBag | undefined, where: string) => {
    for (const id of Object.keys(b ?? {})) if (!items.has(id)) issues.error(where, `unknown item "${id}"`);
  };

  const dupCheck = (label: string, values: string[]) => {
    for (const d of duplicates(values)) issues.error(label, `duplicate id "${d}"`);
  };
  dupCheck("levels", bundle.levels.map((l) => l.levelId));
  dupCheck("chapters", progression.chapters.map((c) => c.id));
  dupCheck("story", bundle.story.map((b) => b.id));
  dupCheck("characters", bundle.characters.map((c) => c.id));
  dupCheck("economy.items", economy.items.map((i) => i.id));
  dupCheck("economy.boosters", economy.boosters.map((b) => b.id));
  dupCheck("store.products", store.products.map((p) => p.id));
  dupCheck("store.offers", store.offers.map((o) => o.id));

  // Template and mechanic.
  if (!template.mechanics.supported.includes(bundle.game.mechanic)) {
    issues.error("game.json", `template "${template.templateId}" does not support mechanic "${bundle.game.mechanic}"`);
  }

  // Levels: contiguous numbering, references.
  const numbers = bundle.levels.map((l) => l.number).sort((a, b) => a - b);
  numbers.forEach((n, i) => {
    if (n !== i + 1) issues.error("levels.json", `level numbers must run 1..${numbers.length} without gaps (found ${n} at position ${i + 1})`);
  });
  const boosterIds = new Set(economy.boosters.map((b) => b.id));
  for (const level of bundle.levels) {
    const where = `levels.json#${level.levelId}`;
    for (const b of level.boosters.allowed) if (!boosterIds.has(b)) issues.error(where, `unknown booster "${b}"`);
    bag(level.reward, where);
    for (const step of level.tutorial?.steps ?? []) key(step.textKey, `${where}.tutorial`);
  }

  // Progression: chapters cover every level exactly once, in order.
  const sorted = [...progression.chapters].sort((a, b) => a.levels.from - b.levels.from);
  let expected = 1;
  for (const chapter of sorted) {
    const where = `progression.json#${chapter.id}`;
    if (chapter.levels.from > chapter.levels.to) issues.error(where, "levels.from is after levels.to");
    if (chapter.levels.from !== expected) issues.error(where, `chapters must be contiguous: expected to start at level ${expected}`);
    expected = chapter.levels.to + 1;
    key(chapter.titleKey, where);
    key(chapter.subtitleKey, where);
    if (typeof chapter.completionReward === "string" && !economy.rewardTables[chapter.completionReward]) {
      issues.error(where, `unknown reward table "${chapter.completionReward}"`);
    } else if (typeof chapter.completionReward === "object") bag(chapter.completionReward, where);
    for (const beat of [chapter.storyIntro, chapter.storyOutro]) {
      if (beat && !bundle.story.some((b) => b.id === beat)) issues.error(where, `unknown story beat "${beat}"`);
    }
  }
  if (expected - 1 !== bundle.levels.length) {
    issues.error("progression.json", `chapters cover levels 1..${expected - 1} but there are ${bundle.levels.length} levels`);
  }
  if (progression.chapters !== sorted && progression.chapters.some((c, i) => c !== sorted[i])) {
    issues.warn("progression.json", "chapters are not listed in level order");
  }

  // Story and characters.
  const characterIds = new Set(bundle.characters.map((c) => c.id));
  const chapterIds = new Set(progression.chapters.map((c) => c.id));
  for (const character of bundle.characters) {
    key(character.nameKey, `characters.json#${character.id}`);
    for (const rel of character.relationships) {
      if (!characterIds.has(rel.characterId)) issues.error(`characters.json#${character.id}`, `unknown character "${rel.characterId}"`);
    }
  }
  for (const beat of bundle.story) {
    const where = `story.json#${beat.id}`;
    if (beat.trigger.type === "level_complete" && !bundle.levels.some((l) => l.number === (beat.trigger as { level: number }).level)) {
      issues.error(where, `trigger level ${beat.trigger.level} does not exist`);
    }
    if (beat.trigger.type !== "level_complete" && !chapterIds.has(beat.trigger.chapter)) {
      issues.error(where, `trigger chapter "${beat.trigger.chapter}" does not exist`);
    }
    for (const line of beat.lines) {
      if (line.speaker !== "narrator" && !characterIds.has(line.speaker)) issues.error(where, `unknown speaker "${line.speaker}"`);
      key(line.textKey, where);
    }
  }

  // Economy.
  for (const item of economy.items) {
    key(item.nameKey, `economy.items#${item.id}`);
    if (!theme.icons[item.icon]) issues.error(`economy.items#${item.id}`, `theme "${theme.themeId}" has no icon "${item.icon}"`);
  }
  if (economy.energy) {
    const energyItem = items.get(economy.energy.item);
    if (!energyItem) issues.error("economy.energy", `unknown item "${economy.energy.item}"`);
    else if (energyItem.kind !== "energy") issues.error("economy.energy", `item "${energyItem.id}" must have kind "energy"`);
    bag(economy.energy.refillCost, "economy.energy.refillCost");
  } else if (bundle.game.modules.lives) {
    issues.error("economy", "the lives module is enabled but economy.energy is not configured");
  }
  for (const booster of economy.boosters) {
    const item = items.get(booster.id);
    if (!item) issues.error(`economy.boosters#${booster.id}`, "booster has no matching item");
    else if (item.kind !== "booster") issues.error(`economy.boosters#${booster.id}`, `item kind is "${item.kind}", expected "booster"`);
    bag(booster.price, `economy.boosters#${booster.id}.price`);
  }
  for (const [stars, reward] of Object.entries(economy.levelRewards.byStars)) bag(reward, `economy.levelRewards.${stars}`);
  bag(economy.continue.cost, "economy.continue.cost");
  for (const [id, reward] of Object.entries(economy.rewardTables)) bag(reward, `economy.rewardTables.${id}`);
  const coins = (b: ItemBag) => b.coins ?? 0;
  const r = economy.levelRewards.byStars;
  if (!(coins(r["1"]) <= coins(r["2"]) && coins(r["2"]) <= coins(r["3"]))) {
    issues.warn("economy.levelRewards", "rewards should not decrease with more stars");
  }

  // Store and monetization.
  const productIds = new Set(store.products.map((p) => p.id));
  const offerIds = new Set(store.offers.map((o) => o.id));
  for (const product of store.products) {
    bag(product.contents, `store.products#${product.id}`);
    key(product.titleKey, `store.products#${product.id}`);
  }
  for (const offer of store.offers) {
    bag(offer.cost, `store.offers#${offer.id}.cost`);
    bag(offer.contents, `store.offers#${offer.id}.contents`);
    key(offer.titleKey, `store.offers#${offer.id}`);
  }
  for (const section of store.sections) {
    key(section.titleKey, `store.sections#${section.id}`);
    for (const entry of section.entries) {
      if ("product" in entry && !productIds.has(entry.product)) issues.error(`store.sections#${section.id}`, `unknown product "${entry.product}"`);
      if ("offer" in entry && !offerIds.has(entry.offer)) issues.error(`store.sections#${section.id}`, `unknown offer "${entry.offer}"`);
    }
  }
  for (const special of store.specialOffers) {
    if (!productIds.has(special.product)) issues.error(`store.specialOffers#${special.id}`, `unknown product "${special.product}"`);
  }
  if (monetization.ads.enabled && !store.products.some((p) => p.entitlements.includes(monetization.removeAdsEntitlement))) {
    issues.warn("store", `ads are enabled but no product grants "${monetization.removeAdsEntitlement}"`);
  }
  dupCheck("monetization.rewarded", monetization.ads.rewarded.placements.map((p) => p.id));

  // Theme completeness against the template.
  for (const icon of template.requiredIcons) if (!theme.icons[icon]) issues.error(`themes/${theme.themeId}`, `missing required icon "${icon}"`);
  for (const sound of template.requiredSounds) if (!theme.sounds[sound]) issues.error(`themes/${theme.themeId}`, `missing required sound "${sound}"`);
  const assetOfType = (assetKey: string | undefined, type: string, where: string) => {
    if (!assetKey) return;
    const asset = theme.assets[assetKey];
    if (!asset) issues.error(`themes/${theme.themeId}`, `${where} references missing asset "${assetKey}"`);
    else if (asset.type !== type && !(type === "image" && asset.type === "svg")) {
      issues.error(`themes/${theme.themeId}`, `${where} needs a ${type} asset, "${assetKey}" is ${asset.type}`);
    }
  };
  for (const [name, ref] of Object.entries(theme.icons)) if (ref && "asset" in ref) assetOfType(ref.asset, "image", `icon "${name}"`);
  for (const [name, assetKey] of Object.entries(theme.sounds)) assetOfType(assetKey, "audio", `sound "${name}"`);
  for (const [slot, font] of Object.entries(theme.typography)) if (typeof font === "object" && "asset" in font) assetOfType(font.asset, "font", `typography.${slot}`);
  assetOfType(theme.cards.backAsset, "image", "cards.backAsset");
  for (const [name, bg] of Object.entries(theme.backgrounds)) assetOfType(bg.asset, "image", `backgrounds.${name}`);

  // Leaderboards: metric and period must fit together; values come only from verified attempts.
  dupCheck("leaderboards", bundle.leaderboards.map((b) => b.id));
  const eventIds = new Set(bundle.events.map((e) => e.id));
  const periodsFor: Record<string, string[]> = {
    stars_total: ["all_time"], levels_completed: ["all_time"], stars_earned: ["weekly", "daily"], event_points: ["event"],
  };
  for (const board of bundle.leaderboards) {
    const where = `leaderboards.json#${board.id}`;
    if (!periodsFor[board.metric]!.includes(board.period)) {
      issues.error(where, `metric "${board.metric}" needs period ${periodsFor[board.metric]!.join(" or ")}, not "${board.period}"`);
    }
    if (board.metric === "event_points" && (!board.event || !eventIds.has(board.event))) issues.error(where, `unknown event "${board.event ?? ""}"`);
    if (board.minLevel > bundle.levels.length) issues.warn(where, `minLevel ${board.minLevel} is beyond the last level`);
    if (bundle.game.modules.leaderboards) key(board.titleKey, where);
  }
  if (bundle.game.modules.leaderboards && bundle.leaderboards.length === 0) issues.warn("leaderboards", "the module is enabled but no board is defined");
  if (bundle.game.modules.notifications) {
    key("notification.lives_full.title", "notifications");
    key("notification.lives_full.body", "notifications");
  }

  // Localization: every referenced key exists in every locale; placeholders match the default locale.
  const base = bundle.strings[bundle.game.defaultLocale] ?? {};
  for (const locale of bundle.game.locales) {
    const table = bundle.strings[locale] ?? {};
    for (const [k, where] of usedKeys) if (table[k] === undefined) issues.error(`localization ${locale}`, `missing key "${k}" (used by ${where})`);
    if (locale === bundle.game.defaultLocale) continue;
    for (const [k, text] of Object.entries(base)) {
      const other = table[k];
      if (other === undefined) issues.error(`localization ${locale}`, `missing key "${k}"`);
      else if (placeholdersOf(other).join() !== placeholdersOf(text).join()) {
        issues.error(`localization ${locale}`, `placeholders of "${k}" differ from ${bundle.game.defaultLocale}`);
      }
    }
  }
}

const SKU_RULES = {
  ios: /^[A-Za-z0-9._]+$/,
  android: /^[a-z0-9][a-z0-9._]*$/,
} as const;

/** Release configuration against the compiled game: store SKUs and ad placements resolve. */
export function validateRelease(bundle: GameBundle, release: ReleaseDefinition, issues: Issues): void {
  const where = `games/${bundle.game.gameId}/release.json`;
  for (const product of bundle.store.products) {
    for (const platform of ["ios", "android"] as const) {
      const sku = product.storeIds[platform] ?? storeSku(release, platform, product.id);
      if (!SKU_RULES[platform].test(sku) || sku.length > 100) {
        issues.error(where, `${platform} store id "${sku}" of product "${product.id}" is not valid for the store`);
      }
    }
  }
  const placements = new Set([...bundle.monetization.ads.rewarded.placements.map((p) => p.id), "level_end"]);
  for (const platform of ["ios", "android"] as const) {
    for (const placement of Object.keys(release[platform].ads?.placements ?? {})) {
      if (!placements.has(placement)) issues.warn(where, `${platform}.ads.placements: "${placement}" is not a placement in monetization.json`);
    }
  }
  if (release.ios.supportsTablet) issues.warn(where, "ios.supportsTablet: every store locale also needs iPad screenshots");
}

/** Two store apps can never share a bundle id or package. */
export function checkUniqueIdentities(games: Array<{ gameId: string; release: ReleaseDefinition | null }>, issues: Issues): void {
  for (const platform of ["ios", "android"] as const) {
    const owners = new Map<string, string>();
    for (const { gameId, release } of games) {
      if (!release) continue;
      const id = platform === "ios" ? release.ios.bundleId : release.android.package;
      const owner = owners.get(id);
      if (owner) issues.error(`games/${gameId}/release.json`, `${platform} id "${id}" is already used by ${owner}`);
      else owners.set(id, gameId);
    }
  }
}
