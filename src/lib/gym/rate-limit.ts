export interface FixedWindowRateLimiterOptions {
  maxRequests: number;
  windowMs: number;
  now?: () => Date;
}

interface WindowState {
  startedAtMs: number;
  count: number;
}

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, WindowState>();
  private readonly now: () => Date;

  constructor(private readonly options: FixedWindowRateLimiterOptions) {
    this.now = options.now ?? (() => new Date());
  }

  take(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = this.now().getTime();
    const existing = this.windows.get(key);
    if (!existing || now - existing.startedAtMs >= this.options.windowMs) {
      this.windows.set(key, { startedAtMs: now, count: 1 });
      this.prune(now);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (existing.count >= this.options.maxRequests) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(
            (existing.startedAtMs + this.options.windowMs - now) / 1_000,
          ),
        ),
      };
    }
    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private prune(now: number) {
    if (this.windows.size < 256) return;
    for (const [key, value] of this.windows) {
      if (now - value.startedAtMs >= this.options.windowMs) this.windows.delete(key);
    }
  }
}
