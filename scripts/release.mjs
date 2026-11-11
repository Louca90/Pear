// Publication d'une version de Pear. Mode d'emploi complet : RELEASE.md.
//   node scripts/release.mjs bump 1.2.0   version et versionCode suivant dans app.json
//   node scripts/release.mjs draft        brouillon de CHANGELOG.md depuis les commits du dernier tag
//   node scripts/release.mjs build        notes embarquées, APK release signé, empreinte SHA-256
//   node scripts/release.mjs publish      tag, release GitHub signée, envoi de l'APK, puis annonce aux téléphones
//                                         (variable ANNOUNCE_SECRET, la même que sur Vercel ; sans elle, pas d'annonce)
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO = 'Louca90/Pear';
const APP_JSON = join(ROOT, 'app.json');
const CHANGELOG = join(ROOT, 'CHANGELOG.md');
const NOTES = join(ROOT, 'src/update/release-notes.json');
const DIST = join(ROOT, 'dist');
const JAVA_HOME = process.env.JAVA_HOME || 'C:\\Program Files\\Android\\Android Studio\\jbr';

const run = (command, options = {}) => execSync(command, { cwd: ROOT, stdio: 'inherit', ...options });
const output = (command) => execSync(command, { cwd: ROOT, encoding: 'utf8' }).trim();

function readApp() {
  const json = JSON.parse(readFileSync(APP_JSON, 'utf8'));
  return { json, version: json.expo.version, versionCode: json.expo.android.versionCode };
}

function apkPath(version) {
  return join(DIST, `pear-${version}.apk`);
}

// La section d'une version dans CHANGELOG.md : « ## X.Y.Z » jusqu'à la version suivante.
function changelogSection(version) {
  const text = readFileSync(CHANGELOG, 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`## ${version}`));
  if (start < 0) throw new Error(`Pas de section « ## ${version} » dans CHANGELOG.md.`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

// Dans CHANGELOG.md les parties sont en « ### », dans la release elles remontent d'un niveau.
function releaseBody(version) {
  return changelogSection(version).replace(/^#(#+) /gm, '$1 ');
}

function summaryOf(version) {
  const section = changelogSection(version);
  const match = section.match(/### Résumé\n([\s\S]*?)(?=\n### |$)/);
  if (!match) throw new Error(`Pas de « ### Résumé » pour ${version} dans CHANGELOG.md.`);
  return match[1].trim();
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// Signature Ed25519 de « versionCode + sha256 » avec la clé de la configuration distante (scripts/sign-config.mjs).
// Le préfixe et le format doivent rester identiques à releaseSigningMessage (src/update/release.ts).
function signRelease(versionCode, hash) {
  const keyFile = join(homedir(), '.pear', 'remote-config-key.hex');
  if (!existsSync(keyFile)) throw new Error(`Clé de signature absente : ${keyFile} (voir sign-config.mjs init).`);
  const message = new TextEncoder().encode(['pear-release-v1', versionCode, hash].join('\n'));
  return bytesToHex(ed25519.sign(message, hexToBytes(readFileSync(keyFile, 'utf8').trim())));
}

const ANNOUNCE_URL = 'https://pear-drab.vercel.app/api/announce';

// Notification « Pear X.Y est disponible » : un échec ne doit pas faire croire que la release a échoué.
async function announce(version, versionCode) {
  const secret = process.env.ANNOUNCE_SECRET;
  if (!secret) return console.log("ANNOUNCE_SECRET absent : pas d'annonce aux téléphones.");
  const response = await fetch(ANNOUNCE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, versionCode }),
  });
  console.log(response.ok ? 'Annonce envoyée.' : `Annonce refusée (${response.status}).`);
}

function bump(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('Usage : bump X.Y.Z');
  const { json, versionCode } = readApp();
  json.expo.version = version;
  json.expo.android.versionCode = versionCode + 1;
  writeFileSync(APP_JSON, JSON.stringify(json, null, 2) + '\n');
  console.log(`app.json : version ${version}, versionCode ${versionCode + 1}`);
}

function draft() {
  const { version, versionCode } = readApp();
  let range = '';
  try {
    range = `${output('git describe --tags --abbrev=0')}..HEAD`;
  } catch {
    // Aucun tag encore : tout l'historique.
  }
  const commits = output(`git log ${range} --pretty=format:%s`).split('\n').filter(Boolean);
  const existing = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, 'utf8') : '# Journal des versions\n';
  if (existing.includes(`## ${version}`)) throw new Error(`CHANGELOG.md a déjà une section ${version}.`);
  const section = [
    `## ${version} (versionCode ${versionCode})`,
    '',
    '### Résumé',
    '',
    '- À écrire : 3 à 5 lignes pour les utilisateurs.',
    '',
    '### Détails',
    '',
    '#### Nouveautés',
    '',
    '#### Corrections',
    '',
    '#### Technique',
    '',
    ...commits.map((subject) => `- ${subject}`),
    '',
  ].join('\n');
  const [title, ...rest] = existing.split('\n');
  writeFileSync(CHANGELOG, [title, '', section, ...rest].join('\n').replace(/\n{3,}/g, '\n\n'));
  console.log(`Brouillon ajouté dans CHANGELOG.md pour ${version}. Relis-le et range les commits avant build.`);
}

function writeNotes() {
  const { version, versionCode } = readApp();
  // Les pages « Quoi de neuf » sont écrites à la main : on les garde.
  const pages = JSON.parse(readFileSync(NOTES, 'utf8')).pages ?? {};
  const notes = { version, versionCode, summary: summaryOf(version), pages };
  writeFileSync(NOTES, JSON.stringify(notes, null, 2) + '\n');
  console.log(`Notes embarquées : ${NOTES}`);
}

function build() {
  const { version } = readApp();
  writeNotes();
  run('npx tsc --noEmit');
  run('npx jest --silent');
  // CI=1 : pas de question sur les changements non commités.
  run('npx expo prebuild --platform android --no-install', { env: { ...process.env, CI: '1' } });
  const env = { ...process.env, JAVA_HOME };
  const abis = process.argv.includes('--all-abis') ? '' : ' -PreactNativeArchitectures=arm64-v8a';
  run(`"${join(ROOT, 'android', 'gradlew.bat')}" assembleRelease${abis}`, { cwd: join(ROOT, 'android'), env });
  mkdirSync(DIST, { recursive: true });
  const target = apkPath(version);
  copyFileSync(join(ROOT, 'android/app/build/outputs/apk/release/app-release.apk'), target);
  console.log(`\nAPK : ${target}\nTaille : ${statSync(target).size} octets\nsha256 : ${sha256(target)}`);
}

// Le token vient du gestionnaire d'identifiants de git : il n'est jamais écrit ni affiché.
function githubToken() {
  const answer = execFileSync('git', ['credential', 'fill'], { cwd: ROOT, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  const token = answer.match(/^password=(.*)$/m)?.[1];
  if (!token) throw new Error("Aucun identifiant GitHub dans git : connecte-toi une fois avec git push.");
  return token;
}

async function github(token, url, options = {}) {
  const response = await fetch(url.startsWith('http') ? url : `https://api.github.com${url}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...options.headers },
  });
  if (!response.ok) throw new Error(`GitHub ${response.status} : ${await response.text()}`);
  return response.json();
}

async function publish() {
  const { version, versionCode } = readApp();
  const tag = `v${version}`;
  const apk = apkPath(version);
  if (!existsSync(apk)) throw new Error(`APK absent : lance d'abord « build ».`);
  if (output('git status --porcelain --untracked-files=no')) throw new Error('Des changements ne sont pas commités.');
  const hash = sha256(apk);
  const signature = signRelease(versionCode, hash);
  const body = `${releaseBody(version)}\n\nversionCode: ${versionCode}\nsha256: ${hash}\nsignature: ${signature}\n`;

  run(`git tag -a ${tag} -m "Pear ${version}"`);
  run(`git push origin HEAD ${tag}`);
  const token = githubToken();
  const release = await github(token, `/repos/${REPO}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, name: `Pear ${version}`, body, draft: false, prerelease: false, make_latest: 'true' }),
  });
  const uploadUrl = release.upload_url.replace(/\{.*\}$/, `?name=pear-${version}.apk`);
  await github(token, uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/vnd.android.package-archive' },
    body: readFileSync(apk),
  });
  console.log(`Publiée : ${release.html_url}`);
  await announce(version, versionCode).catch((e) => console.log(`Annonce impossible : ${e.message}`));
}

const [command, argument] = process.argv.slice(2);
const commands = { bump: () => bump(argument), draft, notes: writeNotes, build, publish };
if (!commands[command]) {
  console.log('Commandes : bump X.Y.Z | draft | notes | build [--all-abis] | publish');
  process.exit(1);
}
try {
  await commands[command]();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
