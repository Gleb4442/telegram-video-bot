import { describe, expect, it, vi } from 'vitest';
import { MemoryCache } from '../src/utils/cache.js';

describe('MemoryCache', () => {
  it('stores and retrieves cached entries', () => {
    const cache = new MemoryCache<string>(10, 1000);
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('expires entries after TTL', () => {
    vi.useFakeTimers();
    const cache = new MemoryCache<string>(10, 500);
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');

    vi.advanceTimersByTime(600);
    expect(cache.get('key1')).toBeUndefined();
    vi.useRealTimers();
  });

  it('evicts oldest entry when maxEntries is exceeded (LRU behavior)', () => {
    const cache = new MemoryCache<string>(2, 10000);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3'); // Should evict 'a'

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('2');
    expect(cache.get('c')).toBe('3');
  });
});
