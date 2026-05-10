/**
 * Insertion-order LRU cap for a Map. Evicts the least-recently-inserted entry once the
 * cap is hit. Reads do not refresh recency — keeps the implementation O(1) and good
 * enough for caches whose workload is "set rarely, read often" (worktree path → resolved
 * value style).
 *
 * For caches that need true recency promotion, swap to the lru-cache npm dep.
 */
export class BoundedMap<K, V> {
  private readonly inner = new Map<K, V>();

  constructor(private readonly maxEntries: number) {
    if (maxEntries < 1) {
      throw new Error("BoundedMap requires maxEntries >= 1");
    }
  }

  get(key: K): V | undefined {
    return this.inner.get(key);
  }

  has(key: K): boolean {
    return this.inner.has(key);
  }

  set(key: K, value: V): void {
    if (this.inner.has(key)) {
      this.inner.delete(key);
    } else if (this.inner.size >= this.maxEntries) {
      const oldest = this.inner.keys().next().value;
      if (oldest !== undefined) {
        this.inner.delete(oldest);
      }
    }
    this.inner.set(key, value);
  }

  delete(key: K): boolean {
    return this.inner.delete(key);
  }

  clear(): void {
    this.inner.clear();
  }

  get size(): number {
    return this.inner.size;
  }
}
