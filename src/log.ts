import { File, Paths } from 'expo-file-system';
import { LOG_FILE, LOG_MAX_LINES } from './config';

// Journal de débogage local : les derniers événements (réveils, connexions, erreurs), pour comprendre
// pourquoi un message ou une notification a raté. Il ne contient JAMAIS de contenu de message ni de
// clé : seulement le nom de l'étape et le texte des erreurs. Il reste sur le téléphone, et ne part
// que si l'utilisateur l'exporte lui-même.
export type Level = 'debug' | 'info' | 'warn' | 'error';

// Les écritures sur le disque sont regroupées : une seule toutes les quelques secondes au plus.
const SAVE_DELAY_MS = 2000;

let lines: string[] | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function logFile() {
  return new File(Paths.document, LOG_FILE);
}

// Le journal de la session précédente est repris : utile après un plantage.
function buffer() {
  if (lines) return lines;
  lines = [];
  try {
    const file = logFile();
    if (file.exists) lines = file.textSync().split('\n').filter(Boolean).slice(-LOG_MAX_LINES);
  } catch {
    // Journal illisible : on repart d'un journal vide.
  }
  return lines;
}

function save() {
  saveTimer = null;
  try {
    logFile().write(buffer().join('\n') + '\n');
  } catch {
    // Le journal ne doit jamais faire planter l'app.
  }
}

function describe(detail: unknown) {
  if (detail === undefined) return '';
  if (detail instanceof Error) return ` ${detail.name}: ${detail.message}`;
  return ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
}

function write(level: Level, scope: string, detail?: unknown) {
  // En release, les détails de débogage ne sont pas gardés.
  if (level === 'debug' && !__DEV__) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${scope}${describe(detail)}`;
  const all = buffer();
  all.push(line);
  if (all.length > LOG_MAX_LINES) all.splice(0, all.length - LOG_MAX_LINES);
  if (__DEV__) (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(`Pear ${scope}${describe(detail)}`);
  saveTimer ??= setTimeout(save, SAVE_DELAY_MS);
}

export const log = {
  debug: (scope: string, detail?: unknown) => write('debug', scope, detail),
  info: (scope: string, detail?: unknown) => write('info', scope, detail),
  warn: (scope: string, detail?: unknown) => write('warn', scope, detail),
  error: (scope: string, detail?: unknown) => write('error', scope, detail),
};

// Le journal complet dans un fichier texte, prêt à être partagé.
export function exportLog() {
  if (saveTimer) clearTimeout(saveTimer);
  save();
  const copy = new File(Paths.cache, `pear-journal-${new Date().toISOString().slice(0, 10)}.txt`);
  if (copy.exists) copy.delete();
  logFile().copy(copy);
  return copy.uri;
}
