const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, "..", "shared");

const config = getDefaultConfig(projectRoot);

// Общая с вебом логика погоды лежит вне mobile/, поэтому Metro нужно явно
// разрешить следить за этой папкой и резолвить из неё алиас @shared.
config.watchFolders = [sharedRoot];
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "@shared": sharedRoot,
};
// Файлы из shared/ лежат вне mobile/, поэтому их импорты (fast-xml-parser)
// надо явно направить в node_modules приложения — иначе Metro их не найдёт.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

module.exports = config;
