import { useEffect, useRef } from "react";
import { BackHandler } from "react-native";

/**
 * Android's system back button (a no-op on iOS and web). The most recently registered handler runs
 * first and returning true consumes the press. Handlers register once on mount, so a popup, which
 * mounts after the screen under it, always answers first.
 */
export function useBackHandler(handler: () => boolean, enabled = true): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!enabled) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => latest.current());
    return () => subscription.remove();
  }, [enabled]);
}
