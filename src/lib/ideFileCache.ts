interface CacheEntry {
  content: string;
  cachedAt: number;
}

const MAX_ENTRIES = 50;
const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

class IdeFileCache {
  private cache = new Map<string, CacheEntry>();

  get(path: string): string | null {
    const entry = this.cache.get(path);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > MAX_AGE_MS) {
      this.cache.delete(path);
      return null;
    }
    return entry.content;
  }

  set(path: string, content: string): void {
    if (this.cache.size >= MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(path, { content, cachedAt: Date.now() });
  }

  invalidate(path: string): void {
    this.cache.delete(path);
  }

  clear(): void {
    this.cache.clear();
  }
}

export const ideFileCache = new IdeFileCache();
