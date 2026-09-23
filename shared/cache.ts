// Кэш ответов погодных API. Прогноз для одного и того же участка в течение
// часа не меняется, а каждая координата в запросе к Open-Meteo расходует
// квоту — платить за одно и то же дважды незачем. Записи живут в памяти;
// если приложение подключило хранилище, то и на диске — тогда перезапуск
// тоже ничего не стоит.
//
// Хранилище — один текстовый блоб на кэш: записей единицы, по сотне килобайт
// каждая, читать и писать их по одной нет смысла.
export interface CacheStore {
  load(): string | null | Promise<string | null>;
  save(text: string): void | Promise<void>;
}

interface Entry<T> {
  at: number; // время получения, мс
  value: T;
}

export interface Cache<T> {
  // Отдаёт живую запись, иначе вызывает `fetcher`, запоминает и отдаёт
  // результат. Параллельные запросы одного ключа склеиваются в один.
  resolve(key: string, fetcher: () => Promise<T>): Promise<T>;
  attachStore(store: CacheStore): void;
}

export function createCache<T>({
  ttlMs,
  maxEntries,
}: {
  ttlMs: number;
  maxEntries: number;
}): Cache<T> {
  const entries = new Map<string, Entry<T>>();
  const pending = new Map<string, Promise<T>>();
  let store: CacheStore | null = null;
  let loaded: Promise<void> | null = null;

  const isFresh = (entry: Entry<T>, now: number) => now - entry.at < ttlMs;

  // Диск читается один раз, при первом обращении; записи, уже добавленные
  // в память к этому моменту, свежее и остаются.
  const ensureLoaded = () => {
    if (!store) return Promise.resolve();
    if (!loaded) {
      const current = store;
      loaded = Promise.resolve()
        .then(() => current.load())
        .then((text) => {
          if (!text) return;
          const saved = JSON.parse(text) as Record<string, Entry<T>>;
          const now = Date.now();
          for (const [key, entry] of Object.entries(saved)) {
            if (!entries.has(key) && isFresh(entry, now)) entries.set(key, entry);
          }
        })
        .catch((e) => console.warn("Кэш не прочитан:", String(e)));
    }
    return loaded;
  };

  const persist = () => {
    if (!store) return;
    const snapshot = Object.fromEntries(entries);
    Promise.resolve()
      .then(() => store!.save(JSON.stringify(snapshot)))
      .catch((e) => console.warn("Кэш не записан:", String(e)));
  };

  // Протухшие — вон, а из живых оставляем самые свежие: иначе за день катания
  // по разным районам блоб на диске рос бы без предела.
  const prune = (now: number) => {
    for (const [key, entry] of entries) {
      if (!isFresh(entry, now)) entries.delete(key);
    }
    if (entries.size <= maxEntries) return;
    const byAge = [...entries.entries()].sort((a, b) => b[1].at - a[1].at);
    for (const [key] of byAge.slice(maxEntries)) entries.delete(key);
  };

  return {
    async resolve(key, fetcher) {
      await ensureLoaded();

      const hit = entries.get(key);
      if (hit && isFresh(hit, Date.now())) return hit.value;

      const inFlight = pending.get(key);
      if (inFlight) return inFlight;

      const request = fetcher()
        .then((value) => {
          const now = Date.now();
          entries.set(key, { at: now, value });
          prune(now);
          persist();
          return value;
        })
        .finally(() => pending.delete(key));
      pending.set(key, request);
      return request;
    },

    attachStore(next) {
      store = next;
      loaded = null;
    },
  };
}
