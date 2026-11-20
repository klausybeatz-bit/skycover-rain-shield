/**
 * A tiny TTL cache shared by the live-data services.
 *
 * Live data is expensive and rate-limited, so a reading is reused for a short
 * window rather than being re-fetched on every page render. It is deliberately
 * in-memory: like src/lib/upi/server-store.ts this is a per-isolate store, so it
 * reduces calls rather than guaranteeing a hit. A durable cache (Workers KV)
 * would be a drop-in replacement for this class if cross-isolate reuse is ever
 * needed.
 */

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export interface CacheEntryOptions {
  /** Overrides the cache-wide TTL for this entry. */
  ttlMs?: number;
}

export interface CacheHit<T> {
  value: T;
  /** How long the entry has been held, in milliseconds. */
  ageMs: number;
  /** How long it remains valid, in milliseconds. */
  expiresInMs: number;
}

export interface CacheStats {
  entries: number;
  hits: number;
  misses: number;
  evictions: number;
}

export interface TtlCacheOptions {
  /** Default lifetime for entries, in milliseconds. */
  ttlMs: number;
  /** Hard cap on entries; the least recently stored entry is dropped first. */
  maxEntries?: number;
  clock?: Clock;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; storedAt: number; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly clock: Clock;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: TtlCacheOptions) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries ?? 200;
    this.clock = options.clock ?? systemClock;
  }

  /** The cached value if it is still fresh, otherwise undefined. */
  get(key: string): CacheHit<T> | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    const now = this.clock.now();
    if (now >= entry.expiresAt) {
      this.entries.delete(key);
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    return {
      value: entry.value,
      ageMs: now - entry.storedAt,
      expiresInMs: entry.expiresAt - now,
    };
  }

  set(key: string, value: T, options: CacheEntryOptions = {}): void {
    const ttlMs = options.ttlMs ?? this.ttlMs;
    if (ttlMs <= 0) return;

    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) {
        this.entries.delete(oldest.value);
        this.evictions += 1;
      }
    }

    const now = this.clock.now();
    // Re-inserting moves the key to the end, which keeps the eviction order
    // "least recently written" without a full LRU bookkeeping pass.
    this.entries.delete(key);
    this.entries.set(key, { value, storedAt: now, expiresAt: now + ttlMs });
  }

  /** Read through the cache: return the fresh entry, or compute and store one. */
  async resolve(key: string, produce: () => Promise<T>, options: CacheEntryOptions = {}): Promise<{
    value: T;
    cached: boolean;
  }> {
    const hit = this.get(key);
    if (hit) return { value: hit.value, cached: true };
    const value = await produce();
    this.set(key, value, options);
    return { value, cached: false };
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  stats(): CacheStats {
    return { entries: this.entries.size, hits: this.hits, misses: this.misses, evictions: this.evictions };
  }

  /** Reset hit/miss counters. Used by tests. */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }
}

/** A deterministic cache key from a set of ordered inputs. */
export function cacheKeyOf(parts: ReadonlyArray<string | number | null | undefined>): string {
  return parts.map((part) => (part === null || part === undefined ? "" : String(part))).join("|");
}
