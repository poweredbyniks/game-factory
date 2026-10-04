import type { SaveStore } from "@gf/core";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Device storage (AsyncStorage; localStorage on web). If storage is unavailable (private mode,
 * blocked site data) it degrades to memory for the session instead of failing the boot.
 */
const memory = new Map<string, string>();
export const asyncStorageStore: SaveStore = {
  get: async (key) => {
    try {
      return (await AsyncStorage.getItem(key)) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  set: async (key, value) => {
    memory.set(key, value);
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      // Keep playing on the in-memory copy.
    }
  },
  remove: async (key) => {
    memory.delete(key);
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // Nothing persisted to remove.
    }
  },
};
