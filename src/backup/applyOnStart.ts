import { applyPendingRestore } from './restore';

// Importé en tout premier par index.ts : une sauvegarde complète vérifiée remplace la base, les médias
// et les clés avant que quoi que ce soit ne les lise. En cas d'échec, l'app démarre sur ce qu'elle a.
try {
  applyPendingRestore();
} catch (e) {
  console.error('Pear restauration', e);
}
