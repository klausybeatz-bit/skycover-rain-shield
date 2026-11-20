import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { systemClock, TtlCache, cacheKeyOf } from "./cache";

/** A clock the test drives, so no test ever waits for real time to pass. */
function fakeClock(start = 1_000_000) {
  let now = start;
  return {
    clock: { now: () => now },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("TtlCache", () => {
  it("returns a stored value until its TTL elapses, then misses", () => {
    const { clock, advance } = fakeClock();
    const cache = new TtlCache<string>({ ttlMs: 1000, clock });

    cache.set("k", "v");
    expect(cache.get("k")?.value).toBe("v");

    advance(999);
    expect(cache.get("k")?.value).toBe("v");

    advance(1);
    expect(cache.get("k")).toBeUndefined();
  });

  it("reports how long an entry has been held and how long it has left", () => {
    const { clock, advance } = fakeClock();
    const cache = new TtlCache<string>({ ttlMs: 1000, clock });
    cache.set("k", "v");
    advance(400);

    expect(cache.get("k")).toEqual({ value: "v", ageMs: 400, expiresInMs: 600 });
  });

  it("computes once on a miss and reuses the result afterwards", async () => {
    const cache = new TtlCache<number>({ ttlMs: 1000, clock: systemClock });
    let calls = 0;
    const produce = async () => {
      calls += 1;
      return calls;
    };

    expect(await cache.resolve("k", produce)).toEqual({ value: 1, cached: false });
    expect(await cache.resolve("k", produce)).toEqual({ value: 1, cached: true });
    expect(calls).toBe(1);
  });

  it("evicts the least recently written entry at capacity", () => {
    const cache = new TtlCache<number>({ ttlMs: 1000, maxEntries: 2, clock: systemClock });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")?.value).toBe(2);
    expect(cache.get("c")?.value).toBe(3);
    expect(cache.stats().evictions).toBe(1);
  });

  it("does not store anything for a non-positive TTL", () => {
    const cache = new TtlCache<number>({ ttlMs: 1000, clock: systemClock });
    cache.set("k", 1, { ttlMs: 0 });
    expect(cache.get("k")).toBeUndefined();
  });

  it("tracks hits, misses and entries", () => {
    const cache = new TtlCache<number>({ ttlMs: 1000, clock: systemClock });
    cache.set("k", 1);
    cache.get("k");
    cache.get("missing");
    expect(cache.stats()).toMatchObject({ entries: 1, hits: 1, misses: 1 });
  });
});

describe("cacheKeyOf", () => {
  it("is stable and distinguishes different inputs", () => {
    expect(cacheKeyOf(["a", 1, null])).toBe("a|1|");
    expect(cacheKeyOf(["a", 1])).toBe(cacheKeyOf(["a", 1]));
    expect(cacheKeyOf(["a", 1])).not.toBe(cacheKeyOf(["a", 2]));
  });
});

describe("cache test hygiene", () => {
  let cache: TtlCache<number>;
  beforeEach(() => {
    cache = new TtlCache<number>({ ttlMs: 1000, clock: systemClock });
  });
  afterEach(() => {
    cache.clear();
  });

  it("can be cleared between requests", () => {
    cache.set("k", 1);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
