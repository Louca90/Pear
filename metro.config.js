const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Le code natif et les sorties de Gradle ne contiennent aucun JS : sans cette exclusion, Metro surveille
// des milliers de fichiers réécrits à chaque build et finit par se figer (écran gris sur le téléphone).
config.resolver.blockList = [/[\\/]android[\\/](build|app[\\/]build|\.gradle|\.cxx)[\\/].*/, /[\\/]modules[\\/][^\\/]+[\\/]android[\\/].*/];

module.exports = config;
