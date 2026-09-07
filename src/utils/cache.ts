interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * High-performance, zero-dependency in-memory cache with TTL and maximum size limit.
 * Used for caching resolved video streams to drastically reduce Vercel invocation time
 * and eliminate redundant external API requests.
 */
export class MemoryCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly maxEntries: number = 500,
    private readonly defaultTtlMs: number = 30 * 60 * 1000 // 30 minutes
  ) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    // Refresh position for LRU
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    // Evict oldest entry if limit reached
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) {
        this.store.delete(oldestKey);
      }
    }

    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    this.store.set(key, { value, expiresAt });
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
