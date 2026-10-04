import type { ContinueOffer, LevelResult } from "@gf/core";
import { View } from "react-native";
import { useT } from "../runtime/RuntimeContext";
import { Icon } from "../theme/Icon";
import { useTheme } from "../theme/ThemeContext";
import { Button } from "../ui/Button";
import { Popup } from "../ui/Popup";
import { Stars } from "../ui/Stars";
import { Body, Title } from "../ui/Txt";
import { RewardRow } from "./RewardRow";

export function WinPopup({ result, onContinue }: { result: LevelResult; onContinue: () => void }) {
  const t = useT();
  const theme = useTheme();
  return (
    <Popup title={t("ui.win.title")} accent={theme.palette.success} onBack={onContinue} testID="win-popup">
      <View style={{ alignItems: "center", gap: 10 }}>
        <Stars count={result.stars} size={44} />
        <Body color={theme.palette.textMuted}>{t("ui.level", { n: result.number })}</Body>
        {Object.keys(result.rewards).length > 0 ? <RewardRow bag={result.rewards} size={20} /> : null}
        {result.chapterCompleted ? (
          <View style={{ alignItems: "center", gap: 8, marginTop: 6 }}>
            <Title size={20} color={theme.palette.primary}>{t("ui.win.chapter")}</Title>
            <Icon name="chest" size={44} />
            <RewardRow bag={result.chapterReward} />
          </View>
        ) : null}
      </View>
      <Button label={t("ui.win.next")} onPress={onContinue} testID="win-continue" size="lg" />
    </Popup>
  );
}

export function ContinuePopup({
  offer, reason, onCoins, onAd, onGiveUp,
}: {
  offer: ContinueOffer;
  reason: string;
  onCoins: () => void;
  onAd: () => void;
  onGiveUp: () => void;
}) {
  const t = useT();
  const theme = useTheme();
  const extra = offer.kind === "moves" ? t("ui.lose.extra_moves", { n: offer.extraMoves }) : t("ui.lose.extra_cards", { n: offer.extraMoves });
  const price = Object.entries(offer.cost).map(([, v]) => v.toLocaleString("en-US")).join(" ");
  return (
    <Popup title={t(`ui.lose.title.${reason}`)} accent={theme.palette.warning} testID="continue-popup">
      <Body align="center" size={17}>{t("ui.lose.body")}</Body>
      <Button label={`${extra}  ·  ${price}`} icon={<Icon name="coin" size={22} />} onPress={onCoins} disabled={!offer.canAfford} testID="continue-coins" />
      {offer.adAvailable ? <Button label={`${extra}  ·  ${t("ui.lose.watch_ad")}`} icon={<Icon name="ad" size={22} />} variant="secondary" onPress={onAd} testID="continue-ad" /> : null}
      <Button label={t("ui.lose.give_up")} variant="ghost" onPress={onGiveUp} testID="give-up" />
    </Popup>
  );
}

export function LossPopup({ result, canRetry, onRetry, onMap }: { result: LevelResult; canRetry: boolean; onRetry: () => void; onMap: () => void }) {
  const t = useT();
  const theme = useTheme();
  return (
    <Popup title={t(`ui.lose.title.${result.reason === "stuck" ? "stuck" : "out_of_moves"}`)} accent={theme.palette.danger} onBack={onMap} testID="loss-popup">
      <View style={{ alignItems: "center", gap: 6 }}>
        {result.livesLost > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="life" size={26} />
            <Body size={16}>{t("ui.lose.life_lost")}</Body>
          </View>
        ) : null}
      </View>
      {canRetry ? <Button label={t("ui.lose.try_again")} onPress={onRetry} testID="try-again" /> : null}
      <Button label={t("ui.close")} variant="ghost" onPress={onMap} testID="loss-map" />
    </Popup>
  );
}

export function LeavePopup({ onLeave, onStay }: { onLeave: () => void; onStay: () => void }) {
  const t = useT();
  const theme = useTheme();
  return (
    <Popup title={t("ui.leave.title")} accent={theme.palette.warning} onClose={onStay} testID="leave-popup">
      <Body align="center">{t("ui.leave.body")}</Body>
      <Button label={t("ui.leave.cancel")} onPress={onStay} testID="leave-cancel" />
      <Button label={t("ui.leave.confirm")} variant="ghost" onPress={onLeave} testID="leave-confirm" />
    </Popup>
  );
}
