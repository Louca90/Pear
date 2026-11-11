import { describe, expect, it } from '@jest/globals';

import { isSqliteHeader, keyLiteral, planEncryption, sqlPath } from './encryptionPlan';

describe('planEncryption', () => {
  it('chiffre une base en clair, même avec une copie laissée par un essai interrompu', () => {
    expect(planEncryption({ main: 'plain', temp: false, old: false })).toBe('encrypt');
    expect(planEncryption({ main: 'plain', temp: true, old: false })).toBe('encrypt');
  });
  it("termine l'échange interrompu", () => {
    expect(planEncryption({ main: 'absent', temp: true, old: true })).toBe('finish-swap');
  });
  it("remet l'ancienne base si la copie manque", () => {
    expect(planEncryption({ main: 'absent', temp: false, old: true })).toBe('restore-old');
  });
  it("efface l'ancienne base une fois l'échange fait", () => {
    expect(planEncryption({ main: 'encrypted', temp: false, old: true })).toBe('delete-old');
  });
  it('ne fait rien sur une base chiffrée ou une nouvelle installation', () => {
    expect(planEncryption({ main: 'encrypted', temp: false, old: false })).toBe('none');
    expect(planEncryption({ main: 'absent', temp: false, old: false })).toBe('none');
  });
});

describe('isSqliteHeader', () => {
  const bytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
  it('reconnaît une base en clair', () => {
    expect(isSqliteHeader(bytes('SQLite format 3\0suite'))).toBe(true);
  });
  it('refuse des octets aléatoires ou trop courts', () => {
    expect(isSqliteHeader(bytes('\x8a\x01SQLite format 3'))).toBe(false);
    expect(isSqliteHeader(bytes('SQLite'))).toBe(false);
  });
});

describe('keyLiteral', () => {
  it('écrit une clé brute', () => {
    expect(keyLiteral('ab'.repeat(32))).toBe(`"x'${'ab'.repeat(32)}'"`);
  });
  it('refuse tout ce qui n’est pas 64 caractères hexadécimaux', () => {
    expect(() => keyLiteral('ab'.repeat(31))).toThrow();
    expect(() => keyLiteral(`${'ab'.repeat(31)}'"`)).toThrow();
  });
});

describe('sqlPath', () => {
  it('double les apostrophes', () => {
    expect(sqlPath("/a/l'b.db")).toBe("'/a/l''b.db'");
  });
});
