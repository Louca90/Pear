import { describe, expect, it } from '@jest/globals';

import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@noble/curves/utils.js';

import { extractSummary, isReleaseSigned, parseRelease, parseSha256, parseSignature, parseVersionCode, releaseSigningMessage } from './release';

const SHA = 'a'.repeat(64);
const BODY = `## Résumé
- Mise à jour automatique
- Corrections

## Détails
### Nouveautés
- Écran de mise à jour

versionCode: 3
sha256: ${SHA}`;

function release(fields: Record<string, unknown> = {}) {
  return {
    tag_name: 'v1.1.1',
    html_url: 'https://github.com/Louca90/Pear/releases/tag/v1.1.1',
    body: BODY,
    draft: false,
    prerelease: false,
    assets: [{ name: 'pear-1.1.1.apk', size: 1234, browser_download_url: 'https://github.com/Louca90/Pear/releases/download/v1.1.1/pear-1.1.1.apk' }],
    ...fields,
  };
}

describe('parseVersionCode et parseSha256', () => {
  it('lisent les lignes de la description', () => {
    expect(parseVersionCode(BODY)).toBe(3);
    expect(parseSha256(BODY)).toBe(SHA);
  });

  it('renvoient null sans ces lignes', () => {
    expect(parseVersionCode('rien')).toBeNull();
    expect(parseSha256('sha256: trop-court')).toBeNull();
  });
});

describe('extractSummary', () => {
  it('prend la section Résumé jusqu’au titre suivant', () => {
    expect(extractSummary(BODY)).toBe('- Mise à jour automatique\n- Corrections');
  });

  it('accepte « Resume » sans accent et les fins de ligne Windows', () => {
    expect(extractSummary('## Resume\r\nUne ligne\r\n## Détails\r\nx')).toBe('Une ligne');
  });

  it('sans section, garde les premières lignes utiles', () => {
    expect(extractSummary('# Titre\nUn\nDeux\nversionCode: 2\nsha256: abc')).toBe('Un\nDeux');
  });
});

describe('parseRelease', () => {
  it('lit une release au bon format', () => {
    expect(parseRelease(release())).toEqual({
      tag: 'v1.1.1',
      version: '1.1.1',
      versionCode: 3,
      sha256: SHA,
      signature: null,
      summary: '- Mise à jour automatique\n- Corrections',
      pageUrl: 'https://github.com/Louca90/Pear/releases/tag/v1.1.1',
      apkUrl: 'https://github.com/Louca90/Pear/releases/download/v1.1.1/pear-1.1.1.apk',
      apkSize: 1234,
    });
  });

  it('ignore une release sans versionCode, sans APK, en brouillon ou en préversion', () => {
    expect(parseRelease(release({ body: '## Résumé\nx' }))).toBeNull();
    expect(parseRelease(release({ assets: [] }))).toBeNull();
    expect(parseRelease(release({ draft: true }))).toBeNull();
    expect(parseRelease(release({ prerelease: true }))).toBeNull();
  });

  it('refuse un lien de téléchargement qui n’est pas en https', () => {
    expect(parseRelease(release({ assets: [{ name: 'pear.apk', size: 1, browser_download_url: 'http://x/pear.apk' }] }))).toBeNull();
  });

  it('ne plante jamais sur une réponse inattendue', () => {
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease('texte')).toBeNull();
    expect(parseRelease({ message: 'Not Found' })).toBeNull();
  });
});

describe('release signée', () => {
  const secret = ed25519.utils.randomSecretKey();
  const publicKey = bytesToHex(ed25519.getPublicKey(secret));
  const sign = (versionCode: number, sha: string) => bytesToHex(ed25519.sign(releaseSigningMessage(versionCode, sha), secret));
  const signedBody = (signature: string, versionCode = 3) => `${BODY.replace('versionCode: 3', `versionCode: ${versionCode}`)}
signature: ${signature}`;

  it('accepte une release signée avec la bonne clé', () => {
    const parsed = parseRelease(release({ body: signedBody(sign(3, SHA)) }));
    expect(parsed?.signature).toBe(sign(3, SHA));
    expect(isReleaseSigned(parsed!, publicKey)).toBe(true);
  });

  it('ignore une release sans signature', () => {
    const parsed = parseRelease(release());
    expect(parsed).not.toBeNull();
    expect(isReleaseSigned(parsed!, publicKey)).toBe(false);
  });

  it('ignore une signature d’une autre clé, d’un autre versionCode ou d’une autre empreinte', () => {
    const other = bytesToHex(ed25519.sign(releaseSigningMessage(3, SHA), ed25519.utils.randomSecretKey()));
    expect(isReleaseSigned(parseRelease(release({ body: signedBody(other) }))!, publicKey)).toBe(false);
    expect(isReleaseSigned(parseRelease(release({ body: signedBody(sign(3, SHA), 4) }))!, publicKey)).toBe(false);
    expect(isReleaseSigned(parseRelease(release({ body: signedBody(sign(3, 'b'.repeat(64))) }))!, publicKey)).toBe(false);
  });

  it('ne plante pas sur une signature mal formée ou une clé invalide', () => {
    expect(parseSignature('signature: zz')).toBeNull();
    expect(isReleaseSigned(parseRelease(release({ body: signedBody(sign(3, SHA)) }))!, 'pas-une-clé')).toBe(false);
  });
});
