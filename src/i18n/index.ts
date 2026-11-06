import { fr } from './fr';

// Textes de l'interface. fr.ts est la référence : une autre langue reprendra exactement ses clés
// (sélecteur de langue au lot 8). t('accueil.titre') ou, avec des valeurs, t('chat.nouveaux', { n: 3 })
// pour un texte qui contient {n}.

type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type TextKey = Leaves<typeof fr>;
export type TextParams = Record<string, string | number>;

const dictionary = fr;

function lookup(key: string): string {
  let node: unknown = dictionary;
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  return typeof node === 'string' ? node : key;
}

export function t(key: TextKey, params?: TextParams): string {
  const text = lookup(key);
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all));
}

// Pour les composants : la langue ne change pas encore en cours de route, le hook prépare le lot 8.
export function useT() {
  return t;
}
