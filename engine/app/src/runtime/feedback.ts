import type { GameBundle, SoundName } from "@gf/schemas";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { audioModules } from "../generated/assets";

export type HapticKind = "light" | "success" | "error";

/** Sound and haptics resolved from the theme's semantic sound keys. Missing cues are silent. */
export class Feedback {
  private players = new Map<SoundName, AudioPlayer>();
  sound = true;
  haptics = true;

  constructor(private readonly bundle: GameBundle) {
    setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers" }).catch(() => undefined);
  }

  play(name: SoundName): void {
    if (!this.sound) return;
    try {
      let player = this.players.get(name);
      if (!player) {
        const key = this.bundle.theme.sounds[name];
        const asset = key ? this.bundle.theme.assets[key] : undefined;
        if (!asset || asset.type !== "audio") return;
        const source = audioModules[asset.module];
        if (source === undefined) return;
        player = createAudioPlayer(source);
        player.volume = asset.volume;
        this.players.set(name, player);
      }
      player.seekTo(0).catch(() => undefined);
      player.play();
    } catch {
      // Audio must never break gameplay.
    }
  }

  haptic(kind: HapticKind): void {
    if (!this.haptics || Platform.OS === "web") return;
    const run =
      kind === "light"
        ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        : Haptics.notificationAsync(kind === "success" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
    run.catch(() => undefined);
  }
}
