import { isReleaseSigned, Release } from './release';

// Programme testeur : parmi les releases lues (stables et pré-versions), laquelle proposer ?
// Les mises à jour normales passent toujours devant : une version de test n'est proposée que si son
// versionCode dépasse celui de la dernière stable ET celui installé. Sans programme testeur, seules les
// stables comptent. Une release non signée est ignorée.
export function chooseRelease(releases: Release[], installedCode: number, testerOn: boolean, publicKeyHex: string): Release | null {
  const signed = releases.filter((release) => isReleaseSigned(release, publicKeyHex));
  const best = (list: Release[]) => list.reduce<Release | null>((top, release) => (!top || release.versionCode > top.versionCode ? release : top), null);
  const stable = best(signed.filter((release) => !release.prerelease));
  const test = testerOn ? best(signed.filter((release) => release.prerelease)) : null;
  if (test && test.versionCode > (stable?.versionCode ?? 0) && test.versionCode > installedCode) return test;
  if (stable && stable.versionCode > installedCode) return stable;
  return null;
}
