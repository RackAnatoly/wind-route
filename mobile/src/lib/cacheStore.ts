import { Directory, File, Paths } from "expo-file-system";
import type { CacheStore } from "@shared/cache";

// Хранилище для кэшей из `shared/`: один JSON-файл на кэш в кэш-директории
// приложения. Система вправе её почистить — тогда просто сходим в API заново.
// Файловый API expo синхронный, а хранилище может быть любым: интерфейс
// допускает и промисы.
const CACHE_DIR = "weather-cache";

export function fileCacheStore(name: string): CacheStore {
  const root = new Directory(Paths.cache, CACHE_DIR);
  const file = new File(root, `${name}.json`);

  return {
    load() {
      return file.exists ? file.textSync() : null;
    },
    save(text) {
      if (!root.exists) root.create({ intermediates: true });
      file.create({ overwrite: true });
      file.write(text);
    },
  };
}
