export type Strings = Record<string, Record<string, string>>;

export function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
    params[key] !== undefined ? String(params[key]) : match,
  );
}

/** Lookup with fallback to the default locale; a missing key renders as [key] so it is visible. */
export function translate(
  strings: Strings,
  locale: string,
  fallbackLocale: string,
  key: string,
  params?: Record<string, string | number>,
): string {
  const text = strings[locale]?.[key] ?? strings[fallbackLocale]?.[key];
  return text === undefined ? `[${key}]` : interpolate(text, params);
}
