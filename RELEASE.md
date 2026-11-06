# Publier une version de Pear

Les téléphones vérifient la dernière release du dépôt `Louca90/Pear` (API publique de GitHub, sans clé). Si son `versionCode` est plus grand que celui de l'APK installé, l'app affiche un écran bloquant « Mise à jour disponible ». Même package et même clé de signature : les conversations restent intactes.

## Convention

- Tag `vX.Y.Z`, release nommée `Pear X.Y.Z`, ni brouillon ni préversion.
- Pièce jointe : `pear-X.Y.Z.apk`.
- Description, dans cet ordre :

```markdown
## Résumé

- 3 à 5 lignes courtes en français, pour les utilisateurs.

## Détails

### Nouveautés
- …
### Corrections
- …
### Technique
- …

versionCode: 3
sha256: 9f2c…(64 caractères hexadécimaux)
```

L'app affiche la section « Résumé » (jusqu'au titre suivant) et un lien vers la release. Sans cette section, elle affiche les premières lignes de la description. Sans ligne `versionCode`, la release est ignorée. Avec une ligne `sha256`, le fichier téléchargé est vérifié avant l'installation.

`CHANGELOG.md` garde une section par version, la plus récente en haut, avec les mêmes parties en `###` : le script les remonte d'un niveau pour la release.

## Étapes

1. `node scripts/release.mjs bump 1.2.0` : version et `versionCode` suivant dans `app.json`.
2. `node scripts/release.mjs draft` : ajoute dans `CHANGELOG.md` un brouillon avec les commits depuis le dernier tag. Le relire, écrire le Résumé, ranger les commits.
3. Commiter (`app.json`, `CHANGELOG.md`).
4. `node scripts/release.mjs build` : génère `src/update/release-notes.json` (le Résumé embarqué, lisible hors ligne par le popup « Pear est à jour ! »), vérifie les types et les tests, compile l'APK release signé (arm64, `--all-abis` pour toutes les architectures) dans `dist/` et affiche son empreinte.
5. Commiter `src/update/release-notes.json` s'il a changé.
6. `node scripts/release.mjs publish` : crée le tag, pousse, crée la release GitHub avec la description et envoie l'APK. Le token vient du gestionnaire d'identifiants de git ; il n'est jamais écrit ni affiché.

## À savoir

- Le keystore et ses mots de passe restent hors du dépôt (`~/.gradle/gradle.properties`), voir `plugins/with-release-signing.js`.
- En debug (Metro), l'écran bloquant ne s'affiche jamais. Profil → « Voir l'écran de mise à jour (debug) » permet de le tester.
- Hors ligne ou GitHub injoignable, l'app s'ouvre normalement.
- Limite de l'API GitHub sans clé : 60 requêtes par heure et par adresse IP. L'app ne vérifie pas plus d'une fois toutes les 5 minutes.

## Configuration distante (sans nouvel APK)

L'URL du serveur de réveil et les serveurs STUN peuvent changer sans publier d'APK :

1. Modifier `config/remote-config.values.json` (URL en `https://` obligatoire).
2. `node scripts/sign-config.mjs` : signe vers `config/remote-config.json` avec la clé `~/.pear/remote-config-key.hex`.
3. Commiter et pousser sur `main`. Les téléphones lisent le fichier au lancement (raw.githubusercontent, quelques minutes de cache).

Un fichier mal signé, non valide ou plus ancien que celui déjà reçu est ignoré : l'app garde sa configuration, ou les valeurs de `src/config.ts`.
La clé privée ne doit jamais entrer dans le dépôt. La sauvegarder avec le keystore : sans elle, il faut publier un APK avec une nouvelle clé publique (`node scripts/sign-config.mjs init`).
