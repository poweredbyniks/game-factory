import type { ProductInfo, PurchaseResult } from "@gf/core";
import type { ItemBag } from "@gf/schemas";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useFeedback } from "../runtime/FeedbackContext";
import { useRuntime, useServices, useSnapshot, useT } from "../runtime/RuntimeContext";
import { Icon } from "../theme/Icon";
import { useTheme } from "../theme/ThemeContext";
import { Button } from "../ui/Button";
import { Popup } from "../ui/Popup";
import { useToast } from "../ui/Toast";
import { Body, Title } from "../ui/Txt";
import { RewardRow } from "./RewardRow";

const PURCHASE_MESSAGE: Partial<Record<Extract<PurchaseResult, { ok: false }>["reason"], string>> = {
  pending: "ui.shop.pending",
  verification_pending: "ui.shop.verification_pending",
  owned: "ui.shop.owned",
};

/** Shop built entirely from store.json: sections, coin offers and IAP products. */
export function ShopPopup({ onClose }: { onClose: () => void }) {
  const runtime = useRuntime();
  const { iap } = useServices().platform;
  const snap = useSnapshot();
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const feedback = useFeedback();
  const [prices, setPrices] = useState<Record<string, string>>({});
  const store = runtime.config.store;

  useEffect(() => {
    runtime.analytics.track("shop_opened", { placement: "map" });
    iap
      .products(store.products.map((p) => p.id))
      .then((list: ProductInfo[]) => setPrices(Object.fromEntries(list.map((p) => [p.id, p.price]))))
      .catch(() => undefined);
  }, [runtime, iap, store.products]);

  return (
    <Popup title={t("ui.shop.title")} onClose={onClose} testID="shop-popup" maxHeight={720}>
      {store.sections.map((section) => (
        <View key={section.id} style={{ gap: 8 }}>
          <Title size={17} color={theme.palette.textMuted}>{t(section.titleKey)}</Title>
          {section.entries.map((entry) => {
            if ("offer" in entry) {
              const offer = store.offers.find((o) => o.id === entry.offer);
              if (!offer) return null;
              return (
                <Row key={offer.id} title={t(offer.titleKey)} contents={<RewardRow bag={offer.contents} size={14} />}>
                  <Button
                    size="sm"
                    variant="secondary"
                    label={Object.values(offer.cost).join(" + ")}
                    icon={<Icon name={costIcon(offer.cost)} size={16} />}
                    testID={`offer-${offer.id}`}
                    onPress={() => {
                      const result = runtime.buyOffer(offer.id);
                      if (result.ok) feedback.play("coin");
                      else toast(t(result.reason === "cannot_afford" ? "ui.booster.cannot_afford" : "ui.booster.limit"));
                    }}
                  />
                </Row>
              );
            }
            const product = store.products.find((p) => p.id === entry.product);
            if (!product) return null;
            const owned = product.type === "non_consumable" && product.entitlements.every((e) => snap.entitlements.includes(e));
            return (
              <Row key={product.id} title={t(product.titleKey)} contents={<RewardRow bag={product.contents} size={14} />}>
                <Button
                  size="sm"
                  label={owned ? t("ui.shop.owned") : (prices[product.id] ?? "…")}
                  disabled={owned}
                  testID={`product-${product.id}`}
                  onPress={() => {
                    void runtime.purchaseProduct(product.id).then((result) => {
                      if (result.ok) {
                        feedback.play("coin");
                        toast(t("ui.shop.purchased"));
                      } else toast(t(PURCHASE_MESSAGE[result.reason] ?? "ui.shop.failed"));
                    });
                  }}
                />
              </Row>
            );
          })}
        </View>
      ))}
      {store.products.some((p) => p.type !== "consumable") ? (
        <Button
          label={t("ui.shop.restore")}
          variant="ghost"
          size="sm"
          testID="shop-restore"
          onPress={() => {
            void runtime.restorePurchases().then((result) => {
              if (!result.ok) toast(t("ui.shop.failed"));
              else toast(t(result.restored.length > 0 ? "ui.shop.restored" : "ui.shop.nothing_to_restore"));
            });
          }}
        />
      ) : null}
      <Button label={t("ui.close")} variant="ghost" onPress={onClose} testID="shop-close" />
    </Popup>
  );

  function costIcon(cost: ItemBag) {
    const itemId = Object.keys(cost)[0];
    return runtime.config.economy.items.find((i) => i.id === itemId)?.icon ?? "coin";
  }
}

function Row({ title, contents, children }: { title: string; contents: React.ReactNode; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.palette.surfaceAlt, borderRadius: theme.shape.radiusMd, padding: 10 }}>
      <View style={{ flex: 1, gap: 4, alignItems: "flex-start" }}>
        <Body size={15}>{title}</Body>
        {contents}
      </View>
      {children}
    </View>
  );
}
