import * as SecureStore from 'expo-secure-store';

import { de } from './de';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { it } from './it';
import { nl } from './nl';
import { pt } from './pt';

// Textes de l'interface. fr.ts est la référence : les autres langues reprennent ses clés, et une clé
// absente retombe sur le français. t('accueil.titre') ou, avec des valeurs, t('chat.nouveaux', { n: 3 })
// pour un texte qui contient {n}.

type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type TextKey = Leaves<typeof fr>;
export type TextParams = Record<string, string | number>;
// Une traduction : les mêmes rubriques que le français, chaque texte pouvant manquer.
export type Dictionary = { [Section in keyof typeof fr]?: { [Key in keyof (typeof fr)[Section]]?: string } };

export type Language = 'fr' | 'en' | 'es' | 'de' | 'it' | 'pt' | 'nl';
export type LanguageChoice = Language | 'auto';

// Nom de chaque langue dans sa propre langue, pour le sélecteur.
export const LANGUAGES: { code: Language; name: string }[] = [
  { code: 'fr', name: 'Français' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'nl', name: 'Nederlands' },
];

const DICTIONARIES: Record<Language, Dictionary> = { fr, en, es, de, it, pt, nl };
const DATE_LOCALES: Record<Language, string> = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES', de: 'de-DE', it: 'it-IT', pt: 'pt-PT', nl: 'nl-NL' };
const STORE_KEY = 'pear.language';

function deviceLanguage(): Language {
  try {
    const code = Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 2).toLowerCase();
    return code in DICTIONARIES ? (code as Language) : 'fr';
  } catch {
    return 'fr';
  }
}

// Lu une seule fois au démarrage (beaucoup de textes sont calculés à l'ouverture) : changer de langue
// recharge l'app.
function readChoice(): LanguageChoice {
  try {
    const stored = SecureStore.getItem(STORE_KEY);
    return stored && (stored === 'auto' || stored in DICTIONARIES) ? (stored as LanguageChoice) : 'auto';
  } catch {
    return 'auto';
  }
}

const choice = readChoice();
const language: Language = choice === 'auto' ? deviceLanguage() : choice;
const dictionary = DICTIONARIES[language];

export function languageChoice(): LanguageChoice {
  return choice;
}

export function currentLanguage(): Language {
  return language;
}

// Pour les dates et les tris : la langue choisie.
export function dateLocale() {
  return DATE_LOCALES[language];
}

export async function saveLanguageChoice(next: LanguageChoice) {
  await SecureStore.setItemAsync(STORE_KEY, next);
}

function lookup(source: unknown, key: string): string | null {
  let node: unknown = source;
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  return typeof node === 'string' ? node : null;
}

export function t(key: TextKey, params?: TextParams): string {
  const text = lookup(dictionary, key) ?? lookup(fr, key) ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all));
}

export function useT() {
  return t;
}
