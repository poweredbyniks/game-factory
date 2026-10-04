import type { GameRuntime, MemoryAnalyticsProvider, RuntimeSnapshot } from "@gf/core";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { PlatformServices } from "../platform";

export type Services = { runtime: GameRuntime; events: MemoryAnalyticsProvider; platform: PlatformServices };
const RuntimeContext = createContext<Services | null>(null);

export function RuntimeProvider({ value, children }: { value: Services; children: ReactNode }) {
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useServices(): Services {
  const services = useContext(RuntimeContext);
  if (!services) throw new Error("RuntimeProvider is missing");
  return services;
}

export function useRuntime(): GameRuntime {
  return useServices().runtime;
}

/** Re-renders when the runtime publishes a new snapshot. */
export function useSnapshot(): RuntimeSnapshot {
  const runtime = useRuntime();
  return useSyncExternalStore(runtime.subscribe.bind(runtime), runtime.getSnapshot, runtime.getSnapshot);
}

export function useT() {
  return useRuntime().t;
}
