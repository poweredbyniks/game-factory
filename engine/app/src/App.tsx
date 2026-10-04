import { GameRuntime, MemoryAnalyticsProvider } from "@gf/core";
import type { Platform as GfPlatform } from "@gf/schemas";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { AppState, Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { bundle } from "./bundle";
import { fontModules } from "./generated/assets";
import { MECHANICS } from "./mechanics";
import { AdOverlay } from "./popups/AdOverlay";
import { SettingsPopup } from "./popups/SettingsPopup";
import { ShopPopup } from "./popups/ShopPopup";
import { createPlatformServices } from "./platform";
import { release } from "./release";
import { Feedback } from "./runtime/feedback";
import { FeedbackProvider } from "./runtime/FeedbackContext";
import { RuntimeProvider, useRuntime, useSnapshot, useT, type Services } from "./runtime/RuntimeContext";
import { LevelScreen } from "./screens/LevelScreen";
import { MapScreen } from "./screens/MapScreen";
import { ThemeProvider, buildTheme } from "./theme/ThemeContext";
import { ToastHost, useToast } from "./ui/Toast";

/** Platform services first (consent before any SDK), then the shared runtime on top of them. */
async function boot(): Promise<Services> {
  const events = new MemoryAnalyticsProvider(200);
  const platform = await createPlatformServices(bundle, release, events);
  const runtime = await GameRuntime.create({
    bundle,
    mechanics: MECHANICS,
    store: platform.store,
    platform: Platform.OS as GfPlatform,
    appVersion: bundle.game.version,
    analyticsProviders: platform.analytics,
    ads: platform.ads,
    iap: platform.iap,
    purchaseVerifier: platform.purchaseVerifier,
    notifications: platform.notifications,
    log: (message) => console.warn(message),
  });
  if (platform.remoteConfig) void runtime.refreshRemoteConfig(platform.remoteConfig);
  return { runtime, events, platform };
}

const fontMap = Object.fromEntries(
  Object.values(bundle.theme.assets).flatMap((a) => (a.type === "font" && fontModules[a.module] !== undefined ? [[a.family, fontModules[a.module]!]] : [])),
);

export default function App() {
  const theme = useMemo(() => buildTheme(bundle.theme), []);
  const [fontsLoaded] = useFonts(fontMap);
  const [services, setServices] = useState<Services | null>(null);
  const feedback = useMemo(() => new Feedback(bundle), []);
  useEffect(() => {
    boot().then(setServices, (error: unknown) => console.error("boot failed", error));
  }, []);
  if (!fontsLoaded || !services) return <View style={{ flex: 1, backgroundColor: theme.palette.background }} />;
  return (
    <SafeAreaProvider>
      <ThemeProvider theme={theme}>
        <RuntimeProvider value={services}>
          <FeedbackProvider value={feedback}>
            <ToastHost>
              <Shell feedback={feedback} />
              <AdOverlay />
            </ToastHost>
          </FeedbackProvider>
        </RuntimeProvider>
      </ThemeProvider>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

function Shell({ feedback }: { feedback: Feedback }) {
  const runtime = useRuntime();
  const snap = useSnapshot();
  const t = useT();
  const toast = useToast();
  const [route, setRoute] = useState<"map" | "level">(() => (runtime.getSnapshot().session ? "level" : "map"));
  const [overlay, setOverlay] = useState<"shop" | "settings" | null>(null);
  feedback.sound = snap.settings.sound;
  feedback.haptics = snap.settings.haptics;

  useEffect(() => {
    // Paid transactions the store still holds (an app kill mid-purchase, an approved Ask to Buy).
    const recover = () => {
      void runtime.reconcilePurchases().then((delivered) => {
        if (delivered.length > 0) toast(t("ui.shop.recovered"));
      });
    };
    recover();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        runtime.startSession();
        recover();
      } else if (state === "background") {
        runtime.endSession();
        void runtime.flush();
      }
    });
    return () => sub.remove();
  }, [runtime, toast, t]);

  return (
    <View style={{ flex: 1, backgroundColor: buildThemeBackground() }}>
      {route === "map" ? (
        <MapScreen onPlay={() => setRoute("level")} onShop={() => setOverlay("shop")} onSettings={() => setOverlay("settings")} />
      ) : (
        <LevelScreen onExit={() => setRoute("map")} />
      )}
      {overlay === "shop" ? <ShopPopup onClose={() => setOverlay(null)} /> : null}
      {overlay === "settings" ? <SettingsPopup onClose={() => setOverlay(null)} /> : null}
    </View>
  );
}

function buildThemeBackground(): string {
  return bundle.theme.palette.background;
}
