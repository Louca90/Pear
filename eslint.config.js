// Règles de base d'Expo (React, React Native, TypeScript). `npm run lint` les vérifie.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['android/**', 'dist/**', 'server/node_modules/**', 'modules/*/android/**', '.expo/**'],
  },
  {
    // Fonctions Vercel et leurs tests : du Node, avec ses globales (Buffer, __dirname).
    files: ['server/**/*.js'],
    languageOptions: { globals: { Buffer: 'readonly', __dirname: 'readonly', process: 'readonly', console: 'readonly' } },
  },
  {
    rules: {
      // Règles du React Compiler, que Pear n'utilise pas : elles signalent comme erreurs l'usage
      // normal des animations de React Native (useRef(new Animated.Value(0)).current lu au rendu).
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off',
      // Le texte de l'interface est en français : les apostrophes dans le JSX sont partout, et sans danger.
      'react/no-unescaped-entities': 'off',
    },
  },
]);
