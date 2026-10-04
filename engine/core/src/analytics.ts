import type { AnalyticsTaxonomy, ParamSpec } from "@gf/schemas";

export type ParamValue = string | number | boolean;
export type AnalyticsEvent = { name: string; params: Record<string, ParamValue>; ts: number };

export interface AnalyticsProvider {
  readonly name: string;
  track(event: AnalyticsEvent): void;
  flush?(): Promise<void>;
}

/** Keeps every event in memory: tests, simulations and the in-app debug panel. */
export class MemoryAnalyticsProvider implements AnalyticsProvider {
  readonly name = "memory";
  readonly events: AnalyticsEvent[] = [];
  constructor(private readonly limit = Infinity) {}
  track(event: AnalyticsEvent): void {
    this.events.push(event);
    if (this.events.length > this.limit) this.events.shift();
  }
  count(name: string): number {
    return this.events.filter((e) => e.name === name).length;
  }
  last(name?: string): AnalyticsEvent | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) if (!name || this.events[i]!.name === name) return this.events[i];
    return undefined;
  }
}

/** Writes one line per event to an injected logger (console in the app, stdout in tools). */
export class LoggerAnalyticsProvider implements AnalyticsProvider {
  readonly name = "logger";
  constructor(private readonly log: (line: string) => void) {}
  track(event: AnalyticsEvent): void {
    this.log(`[analytics] ${event.name} ${JSON.stringify(event.params)}`);
  }
}

function typeMatches(spec: ParamSpec, value: ParamValue): boolean {
  switch (spec.type) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "int":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
  }
}

/** Problems with an event against the taxonomy; empty when valid. */
export function validateEvent(taxonomy: AnalyticsTaxonomy, name: string, params: Record<string, ParamValue>): string[] {
  const def = taxonomy.events[name];
  if (!def) return [`unknown event "${name}"`];
  const specs: Record<string, ParamSpec> = { ...taxonomy.commonParams, ...def.params };
  const problems: string[] = [];
  for (const [key, spec] of Object.entries(specs)) {
    const value = params[key];
    if (value === undefined) {
      if (spec.required) problems.push(`${name}: missing param "${key}"`);
    } else if (!typeMatches(spec, value)) {
      problems.push(`${name}: param "${key}" should be ${spec.type}, got ${JSON.stringify(value)}`);
    }
  }
  for (const key of Object.keys(params)) {
    if (!specs[key]) problems.push(`${name}: undeclared param "${key}"`);
  }
  return problems;
}

export type AnalyticsOptions = {
  /** Throw on invalid events (tests and development builds). */
  strict: boolean;
  common: () => Record<string, ParamValue>;
  now: () => number;
  onInvalid?: (problems: string[]) => void;
};

export class Analytics {
  constructor(
    private readonly taxonomy: AnalyticsTaxonomy,
    private readonly providers: AnalyticsProvider[],
    private readonly opts: AnalyticsOptions,
  ) {}

  track(name: string, params: Record<string, ParamValue> = {}): void {
    const full = { ...this.opts.common(), ...params };
    const problems = validateEvent(this.taxonomy, name, full);
    if (problems.length > 0) {
      if (this.opts.strict) throw new Error(problems.join("; "));
      this.opts.onInvalid?.(problems);
    }
    const event: AnalyticsEvent = { name, params: full, ts: this.opts.now() };
    for (const provider of this.providers) provider.track(event);
  }

  async flush(): Promise<void> {
    await Promise.all(this.providers.map((p) => p.flush?.()));
  }
}
