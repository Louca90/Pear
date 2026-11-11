import { describe, expect, it } from '@jest/globals';

import { decodeEntities, firstLink, parsePreview } from './linkPreviewParse';

describe('aperçu des liens', () => {
  it('trouve le premier lien du texte', () => {
    expect(firstLink('regarde https://exemple.fr/page. et aussi http://autre.fr')).toBe('https://exemple.fr/page');
    expect(firstLink('va sur www.exemple.fr !')).toBe('https://www.exemple.fr');
    expect(firstLink('aucun lien ici')).toBeNull();
  });

  it('décode les entités HTML', () => {
    expect(decodeEntities('Fromage &amp; vin &#233;t&#xE9; &inconnu;')).toBe('Fromage & vin été &inconnu;');
  });

  it('lit le titre, le site et l’image Open Graph', () => {
    const html = `<html><head><title>Titre de secours</title>
      <meta property="og:title" content="L&#39;article du jour">
      <meta content="Le Journal" property="og:site_name">
      <meta property='og:image' content='/images/une.jpg'></head></html>`;
    expect(parsePreview(html, 'https://www.journal.fr/a/b')).toEqual({
      url: 'https://www.journal.fr/a/b',
      title: "L'article du jour",
      site: 'Le Journal',
      imageUrl: 'https://www.journal.fr/images/une.jpg',
    });
  });

  it('se contente de la balise title et du nom de domaine', () => {
    expect(parsePreview('<title>\n  Ma page\n</title>', 'https://www.exemple.fr/x')).toEqual({ url: 'https://www.exemple.fr/x', title: 'Ma page', site: 'exemple.fr', imageUrl: null });
  });

  it('ne garde ni une page sans titre ni une image qui n’est pas http(s)', () => {
    expect(parsePreview('<p>rien</p>', 'https://exemple.fr')).toBeNull();
    expect(parsePreview('<title>T</title><meta property="og:image" content="javascript:alert(1)">', 'https://exemple.fr')?.imageUrl).toBeNull();
  });
});
