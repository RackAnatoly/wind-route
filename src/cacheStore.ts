import type { CacheStore } from "@shared/cache";

// Хранилище для кэшей из `shared/` в браузере: по ключу в localStorage.
// Он может быть недоступен (приватный режим, запрет на сайт) — тогда кэш
// живёт только в памяти, и это нормально.
const PREFIX = "weather-cache:";

export function localCacheStore(name: string): CacheStore {
  const key = PREFIX + name;
  return {
    load() {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    save(text) {
      try {
        localStorage.setItem(key, text);
      } catch {
        // квота или запрет — молча остаёмся в памяти
      }
    },
  };
}
