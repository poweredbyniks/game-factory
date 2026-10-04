import type { RemoteConfigProvider } from "@gf/core";

/** Fetches a remote-config payload over HTTPS with a timeout. */
export class HttpRemoteConfigProvider implements RemoteConfigProvider {
  constructor(private readonly url: string, private readonly timeoutMs = 4000) {}
  async fetch(): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url, { signal: controller.signal });
      if (!res.ok) throw new Error(`remote config HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}
