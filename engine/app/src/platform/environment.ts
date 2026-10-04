import { AppEnvironment } from "@gf/schemas";
import Constants from "expo-constants";

/** The build environment: APP_ENV when app.config.ts ran (the EAS build profile, or the local shell). */
export const APP_ENV: AppEnvironment = AppEnvironment.catch("development").parse(Constants.expoConfig?.extra?.environment);
