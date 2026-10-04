import { z } from "zod";
import { Id, ItemBag, LocKey, SchemaVersion } from "./common";

export const ProductDefinition = z.strictObject({
  id: Id,
  type: z.enum(["consumable", "non_consumable", "subscription"]),
  storeIds: z.strictObject({ ios: z.string().optional(), android: z.string().optional() }),
  titleKey: LocKey,
  contents: ItemBag.default({}),
  entitlements: z.array(Id).default([]).describe("e.g. no_ads"),
  referencePriceUsd: z
    .number()
    .positive()
    .describe("Simulation and development mock only. Real prices always come from the store."),
  tags: z.array(z.string()).default([]),
});
export type ProductDefinition = z.infer<typeof ProductDefinition>;

export const OfferDefinition = z.strictObject({
  id: Id,
  titleKey: LocKey,
  cost: ItemBag,
  contents: ItemBag,
  limitPerDay: z.int().positive().optional(),
});
export type OfferDefinition = z.infer<typeof OfferDefinition>;

export const StoreDefinition = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: SchemaVersion,
    products: z.array(ProductDefinition),
    offers: z.array(OfferDefinition),
    sections: z.array(
      z.strictObject({
        id: Id,
        titleKey: LocKey,
        entries: z.array(z.union([z.strictObject({ product: Id }), z.strictObject({ offer: Id })])),
      }),
    ),
    specialOffers: z
      .array(
        z.strictObject({
          id: Id,
          product: Id,
          trigger: z.discriminatedUnion("type", [
            z.strictObject({ type: z.literal("level_reached"), level: z.int().positive() }),
            z.strictObject({ type: z.literal("out_of_lives") }),
          ]),
          durationHours: z.int().positive(),
          oncePerPlayer: z.boolean(),
        }),
      )
      .default([]),
  })
  .meta({ title: "StoreDefinition", description: "store.json: IAP products, coin offers, shop layout" });
export type StoreDefinition = z.infer<typeof StoreDefinition>;
