# Plan Pear — après l'audit de la v1.5.1 (9 nov. 2026)

Ce fichier contient tous les choix faits avec Louca. Il est fait pour être lu **par morceaux** : une session Claude Code ne lit que la section 1, la section 2 si le lot touche l'interface, et le lot en cours.

---

## 0. Règles qui ne bougent pas

- **Gratuit pour les utilisateurs, toujours.** Côté serveur : tout doit marcher sur les offres gratuites, sans carte bancaire. Un palier payant n'est envisagé que le jour où la communauté le finance (dons), jamais de la poche de Louca. Pas de serveur TURN d'ici là.
- **Public visé : une niche convaincue**, pas le grand public. On ne sacrifie rien à la croissance.
- **Chiffrement de bout en bout** jamais affaibli. Les serveurs ne voient que du chiffré.
- **Aucune bibliothèque tierce de contenu** (GIF, stickers, musique, météo). Tout est local.
- **Jamais d'overkill** : une micro-interaction dure moins de 300 ms, ne bloque jamais un geste, et ne rebondit pas.
- **Migrations SQLite sans perte** (`PRAGMA user_version`) : des gens ont déjà des conversations.
- **Toute nouvelle dépendance native est signalée avant** (elle demande une recompilation).
dire fais a chaque lot realisé modifier le fichier en consequence

---

## 1. Méthode de travail économe en tokens

1. **Un lot = une session.** `/clear` avant chaque lot. Ne jamais enchaîner deux lots dans la même session.
2. **Lecture limitée** : chaque lot liste ses fichiers. Ne rien lire d'autre sans le demander. Pas d'exploration du dépôt, pas de sous-agents.
3. **Zéro capture d'écran.** Les valeurs d'interface sont dans la section 2. Louca valide sur son téléphone et répond en texte à la checklist « Fini quand ».
4. **Vérification** : `npm run typecheck`, `npm test`, et pour le serveur `node server/test/*.test.js`. Les mesures (caméra, connexions) se lisent dans le journal du Diagnostic, collé en texte.
5. **Réponses courtes** : pas de résumé du code écrit, seulement ce qui a changé et ce qui reste à tester.
6. **Recompilation** : les lots marqués `[natif]` sont regroupés par vague pour ne recompiler qu'une fois.

### Quel modèle pour quel lot

- **Petit (Haiku)** : travail mécanique. Couleurs en dur, textes i18n, libellés d'accessibilité, renommages.
- **Moyen (Sonnet)** : par défaut. Interface, micro-interactions à partir des valeurs de la section 2, corrections, fonctions courantes.
- **Gros (Opus ou Fable)** : seulement pour la crypto, la base chiffrée, les règles serveur, les appels, les groupes, et le dessin des animations de la poire (lot 3.2). Utiliser le mode plan, valider le plan, puis laisser un modèle moyen exécuter quand c'est possible.

### Message type pour lancer un lot

```
Lis PLAN_PEAR.md : sections 0, 1 et le lot X.Y uniquement (plus la section 2 si le lot est en vague 3).
Lis seulement les fichiers listés dans le lot. Fais le lot, lance typecheck et tests,
puis donne-moi la checklist « Fini quand » à valider sur mon téléphone.
```

---

TOUT CE QU'IL Y A DANS CET BRACHET QUI EST DEJA FAIS {## 2. Interface : ce qu'on vise

**Ton** : une messagerie sérieuse et professionnelle, utilisable en famille comme entre amis (groupes compris). Rien de mignon ni d'enfantin : la poire est un logo qui s'anime, pas un personnage (pas de visage, pas d'yeux, pas de cœurs, pas de texte familier dans l'interface).

**Intention** : noir et blanc, calme, beaucoup d'espace, comme la prise en main. La couleur signature et la poire sont les deux seules touches de caractère. Tout ce qui bouge est court et doux.

### 2.1 Couleur signature (à ajouter dans `src/theme.ts`)

Jamais en fond d'écran. Seulement boutons, pastilles, indicateurs, anneaux.

- Thème clair : `signature #E6EFCB` (remplissage des boutons), `onSignature #000000`, `signatureStrong #9DB84A` (petits indicateurs : anneau, point, coche « vérifié »).
- Thème sombre : `signature #2B3420`, `onSignature #E3EDC8`, `signatureStrong #B4CC68`.
- Le bouton principal passe de `accent` (noir) à `signature`. Les actions destructrices gardent `danger`.
- Valeurs de départ : Louca les ajuste à l'œil, une seule fois, dans `theme.ts`.

### 2.2 Mouvement (un seul endroit : `theme.ts`, export `motion`)

- `press` 110 ms, `small` 180 ms (apparition, changement d'état), `screen` 180 ms (déjà `ENTER_MS` dans `App.tsx`), `mascot` 420 ms.
- Courbe unique : `Easing.bezier(0.2, 0.8, 0.2, 1)` (déjà `NAV_EASING`). Aucun rebond.
- Appui sur un bouton : échelle 0,97 et opacité 0,85, défini une fois dans `src/components/ui.tsx`.
- Toujours `useNativeDriver: true` (transform et opacité uniquement).
- Si Android a « supprimer les animations » activé : durées à 0, la poire reste fixe.

### 2.3 Vibrations (nouveau `src/haptics.ts`, remplace les 19 appels éparpillés)

- `select` (léger) : changement d'onglet, de filtre, seuil d'un glissement.
- `action` (moyen) : envoi, verrouillage de l'enregistrement, épinglage.
- `success` et `error` : scan réussi, contact vérifié, échec d'envoi.
- Jamais de vibration sur un simple défilement ou une ouverture d'écran.

### 2.4 La poire mascotte (`src/onboarding/Pear.tsx` devient `src/components/Pear.tsx`)

Un seul composant, les tracés actuels (`BODY`, `RIGHT_LEAF`, `LEFT_LEAF`), piloté par deux props : `state` et `progress` (0 à 1). `react-native-svg` et `Animated` suffisent, aucune dépendance en plus.

- `idle` : fixe.
- `bitten` : tirer pour actualiser. Trois bouchées apparaissent à `progress` 0,33 / 0,66 / 1 (masques ronds sur le corps). Au relâchement, la poire se reforme en 420 ms.
- `ripening` : téléchargement de la mise à jour. Le remplissage monte de bas en haut avec `progress`.
- `searching` : contour en pointillés qui tourne lentement (connexion en cours).
- `resting` : écrans vides. Poire fixe en `textMuted`, légère respiration d'échelle 1 à 1,02 sur 3 s. Rien d'autre.
- `leaf` : contact vérifié. La feuille droite pousse (échelle 0 à 1) en `signatureStrong`.
- `sent` (option) : petite poire de 14 points qui part de la saisie vers la bulle, 180 ms. Pas fait.

Où elle apparaît (revu le 11 nov. 2026 à la demande de Louca : chaque état sert à quelque chose de précis, une seule signification par état) :

| État | Ce qu'il veut dire | Où |
|---|---|---|
| `resting` | il n'y a rien ici | listes vides : accueil (aucun contact, filtre vide), contacts, demandes, médias du contact, conversation sans message. Composant `src/components/EmptyState.tsx` (poire + phrase, fondu de 180 ms). |
| `bitten` | je tire pour actualiser | accueil : `src/screens/home/usePullRefresh.tsx`. |
| `searching` | une connexion se fait | accueil pendant l'actualisation (900 ms) ; en-tête de la conversation, à côté du nom, tant que la connexion au contact est en cours (16 points, `textMuted`). |
| `ripening` | quelque chose se remplit | geste des messages éphémères ; photo ou vidéo en cours d'envoi ou de réception (`src/components/TransferPear.tsx`, pastille de 36 points dans le coin du média, à la place de la barre) ; ligne de fichier en transfert (la poire remplace l'icône, la barre reste) ; téléchargement de la mise à jour (72 points, à la place de l'icône et de la barre). |
| `leaf` | c'est vérifié | scan réussi ; badge « vérifié » de la fiche contact. |
| `idle` | le logo | verrou, prise en main, « Quoi de neuf », message système des éphémères (13 points). |

Nulle part ailleurs, et jamais deux poires animées en même temps sur un écran.}


## 3. Refonte de l'interface (commencée le 13 nov. 2026)

### Comment reprendre (à lire en premier si le contexte a été vidé)

1. Lire cette section 3 en entier, puis `git log --oneline -15` pour voir ce qui est fait.
2. Maquettes validées ou à valider : canevas https://claude.ai/artifact/BqLRHtjXVLkUwqRRCo5nyw (lire une planche avec l'outil Artifact, action `read`, `path` = `project/<Planche>.dc.html`). Les fichiers sources des planches sont aussi dans le dossier scratchpad de la session du 13 nov., mais il peut avoir disparu : toujours partir du canevas.
3. Tests en direct sur l'A33 (`RZCTB0BGKGV`), APK debug avec Reanimated déjà installé : `adb -s RZCTB0BGKGV reverse tcp:8081 tcp:8081` puis `npx expo start`. **Ne pas naviguer longuement par adb** : vérifier typecheck, tests et le journal (logcat / Metro), puis demander à Louca de tester.
4. Prendre le premier lot « à faire » ci-dessous, un commit par lot, cocher ici en le finissant.

Planches du canevas (fichier → sujet) : `Main` accueil · `Conversation` · `Profil` profil et réglages · `Icones` icônes animées et poire · `Onboarding` prise en main (avec l'étape Autorisations) · `Nouveautes` · `Camera` (déclencheur) · `Editeur` (onglet Ambiance corrigé) · `Joindre` (remplace la pilule du trombone) · `Contacts` · `Position` partage de position · `Carte` carte des contacts (mode discret) · `ReglagesConv` menu « 3 points » (Apparence / Notifications) · `ProfilContact` profil + médias · `Vocaux` · `LecteurVideo`.

### Règles de la refonte (choix de Louca)

- Garder le noir et blanc + couleur signature, rien d'enfantin, aucun rebond, < 300 ms pour une micro-interaction. Animations sur le fil natif (Reanimated, `src/motion.ts`) ; dans un worklet, toute fonction appelée doit être marquée `'worklet'` (sinon plantage « Tried to synchronously call a Remote Function »).
- Les icônes s'animent **de l'intérieur** (un élément bouge), jamais un simple agrandissement.
- **Pas de flou ni de halo** autour de la poire (essayé, refusé : « dégueulasse »).
- Transfert de photo/vidéo : **la poire `ripening` seule**, grande (40 points dans un rond de 56), qui se remplit fluidement selon le pourcentage. Pas d'anneau.
- **Supprimer les flammes (séries) de toute l'app** (liste, en-tête, nouveautés, réglages, code mort compris).
- Police envisagée pour les maquettes : Inter (à valider avant de l'embarquer).
- **Icône play arrondie** (coins doux, même famille que les autres icônes), jamais le triangle pointu : `M8 5.6v12.8a1.2 1.2 0 0 0 1.8 1.03l10.4-6.4a1.2 1.2 0 0 0 0-2.06L9.8 4.57A1.2 1.2 0 0 0 8 5.6Z` (viewBox 24). À utiliser dans les vocaux, le lecteur vidéo et les vignettes vidéo.
- **Carte hors ligne** (choix du 13 nov.) : aucune tuile téléchargée pendant l'utilisation, rien ne fuit vers un serveur de cartes.
- Carte des contacts : quand on change de contact, la fiche du bas rejoue son entrée (fondu + glissement de 14 points, avatar qui se pose).

### Fait

- [x] Reanimated 4 + Worklets (nouvel APK debug), `src/motion.ts`, appui des boutons et des lignes, icônes de la barre du bas sur le fil natif, icône Contacts (même style que le contour, personne de devant pleine).
- [x] Accueil : pastille des catégories qui se recentre, conversations qui glissent à leur place, pastilles de non-lus en fondu.
- [x] Flash Réglages → Profil corrigé (page cachée avant d'être démontée).
- [x] Défilement de la conversation qui se bloquait (geste des éphémères qui volait le défilement).
- [x] Poire réécrite sur Reanimated : fondu croisé entre états, liquide à vagues, feuilles qui se balancent, bouchées une à une ; pastille de transfert = grande poire qui se remplit.

### À faire (dans cet ordre)

1. [x] **Supprimer les flammes** (fait le 13 nov., commit « Flammes (séries) retirées ») partout (`StreakFlame`, `getStreakState`, page Nouveautés « séries », réglages éventuels). Garder les données en base (migration inutile), seulement ne plus rien afficher.
2. [x] (fait le 13 nov. : `useSmoothProgress`, SeekBar et Waveform sur Reanimated) **Fluidité des barres de progression** : lecture d'un vocal (`VoiceContent`, `Waveform`, `SeekBar`) et lecteur vidéo. La position doit avancer sur le fil natif (valeur partagée animée en continu entre deux mises à jour du lecteur), pas par paliers de `setState`.
> **État au 13 nov. au soir** : lots 3, 4, 5, 6, 7 et l'accueil faits et commités (voir `git log`). Trois agents tournaient encore, sans commiter : **éditeur** (lot 9, `MediaEditor.tsx`, `editor/*`), **appareil photo** (`CameraScreen.tsx`, `camera/*`, `FilterStrip.tsx`) et **contacts + profil/réglages + menu Joindre** (`ContactsScreen.tsx`, `MyQrSheet.tsx`, `ProfileScreen.tsx`, `SettingsScreen.tsx`, `AttachMenu.tsx`, `Composer.tsx`). Mise à jour : l'agent appareil photo a fini (fichiers propres, pas commités : `CameraScreen.tsx`, `camera/ZoomBar.tsx`, `camera/Shutter.tsx`, `camera/CaptureFeedback.tsx`, `FilterStrip.tsx`) ; les agents éditeur et contacts/profil/Joindre ont été **coupés à mi-chemin** par la limite d'utilisation (l'éditeur ne compile pas : `MediaEditor.tsx` lignes ~80, 712-747 ; finir ou `git checkout` ces fichiers). En reprenant : `git status`, relire ces fichiers modifiés, `npm run typecheck` + `npm test`, puis un commit par groupe. Ne pas commiter `README.md` (modifié par Louca). Restes connus : point vert « vocal pas écouté » (aucun champ en base), cartes Position/Chercher/Personnaliser du profil du contact (props à ajouter dans App.tsx), `ACCESS_FINE_LOCATION` absent du manifeste (lot 8). Lot 8 (carte) : signaler la dépendance native (MapLibre envisagé, avec zone téléchargée une fois) et la faire valider avant.

3. [x] **Nouveau lecteur vidéo** (ouvert depuis la conversation, les médias du contact et les notes) : voir la planche « Lecteur vidéo ».
4. [x] **Nouvelle interface des vocaux** : planche « Vocaux ».
5. [x] **Menu « 3 points » d'une conversation** : refaire complètement les 2 catégories (personnalisation : couleur des bulles, fond, etc. ; et l'autre catégorie) : planche « Réglages de la conversation ».
6. [x] **Profil d'un contact + Médias** (appui sur le pseudo) : planche « Profil du contact ».
7. [x] **Prise en main avec les autorisations Android** : notifications, optimisation de la batterie, appareil photo, fichiers/photos, position (filtres de l'appareil photo et partage de position) : planche « Prise en main ».
8. [ ] **Partage de position** (gros lot, natif, mode plan, gros modèle). Fait le 14 nov. : MapLibre 11.5.1 (APK debug installé sur l'A33), style Positron d'OpenFreeMap, zone de 25 km téléchargée une fois (`src/map/offlineMap.ts`, `NetworkManager.setConnected(false)` le reste du temps), carte des contacts (`MapScreen.tsx`, bouton sur l'accueil), mini-carte dans la bulle (image rendue hors ligne, `MiniMap.tsx`), mode discret = arrêter tous mes partages. Fait ensuite : feuille d'envoi (`LocationSheet.tsx`) avec « Tant que l'app est ouverte » (fin glissante de 10 min, arrêt au passage en arrière-plan ou au relancement), carte en style sombre en thème sombre. Aussi le 14 nov. : Stockage, Personnaliser (nouvelle planche `Personnaliser`), icônes animées (`AnimatedIcons.tsx`), barre du bas en pastilles 64 × 52, verrou en interrupteur dans le Profil. Puis : carte au style « Pear » de la planche (`src/map/pearStyle.ts`, couleurs fixes, sombre même en thème clair) ; planches Pop-ups (rangée 6 : `PopupDialogues`, `PopupToasts`, `PopupFeuilles`) codées : `dialog.tsx` (carte en bas, pastille d'icône, liste de choix au-delà de 2 actions, 4e paramètre `{ icon }`), `Toast.tsx`, `UpdatedPopup.tsx`, modèle de feuille `Sheet.tsx` + `SheetChoice` (Langue, Programmer), Envoyer à restylé. Pas fait : le toast « Annuler » de la planche (aucune suppression annulable dans l'app) ; BackupSheet, ReactionsSheet, StickerSheet, MyQrSheet passées sur `Sheet` le 14 nov. (options `keyboard` et `locked` ajoutées au modèle) ; « Envoyer seulement ma position actuelle » fait (`sendCurrentLocation`, drapeau `once` du message de position, réessayé 10 min par la connexion directe sous la clé `once:<contact>`). Reste : « tant que ma localisation est activée » (position en arrière-plan, autorisation « toujours », nouvel APK), et l'APK release.
   - meilleure interface d'envoi ; arrêter le partage le retire aussi chez le contact (message de fin chiffré, la bulle passe à « partage terminé ») ;
   - au lieu d'ouvrir Google Maps : une **mini-carte dans l'app** ;
   - option « partager tout le temps quand la localisation est activée » avec certains contacts ;
   - une **carte de tous ses contacts** qui partagent leur position.
   - Carte **hors ligne**, **zone téléchargée une seule fois** à la demande puis gardée sur le téléphone (décidé le 13 nov.). Reste à trancher en mode plan : moteur de rendu (natif, nouvel APK) et format de la zone. Ensuite : position en arrière-plan (autorisation « toujours », batterie, nouvel APK), fréquence d'envoi, et tout passe chiffré de bout en bout par les sessions existantes.
9. [x] (fait le 14 nov., à valider sur l'A33) **Éditeur photo/vidéo** : barre d'outils en bas, en-tête fermer / annuler / enregistrer / « Envoyer », onglet Ambiance en vignettes découpées (`RoundFiltered`), icône trois cercles.
10. [ ] Le reste des planches validées. Fait le 14 nov. (à valider) : appareil photo (déclencheur), contacts (carte qui se retourne ; **pas de trait de balayage sur le QR**, demandé par Louca : il gêne le scan), joindre (`AttachMenu.tsx` : « + » → « × », feuille avec Récents et tuiles). Fait aussi le 14 nov. (à valider) : appareil photo remis à la mise en page de la planche (aperçu arrondi en bas, bande des filtres dessous, onglets PHOTO / VIDÉO, miniature et caméra de part et d'autre du déclencheur) ; éditeur : un appui sur un outil ajoutait un texte (les Pressable ne bloquent pas le détecteur de gestes : `onChrome` dans `MediaEditor.tsx`) ; profil et réglages en cartes groupées ; accueil (avatars 52, non-lus en vert) ; conversation (point en ligne, statut vert, saisie avec émojis, micro en couleur signature) ; nouveautés en feuille. Erreur « Text strings » : des espaces entre `}` et `</View>` sur une même ligne (accueil, réglages, choix des contacts). Tuiles « Appareil » (route `camera` avec `to` : la photo part directement à ce contact, retour vers la conversation) et « Une fois » (galerie avec `initialOnce`) faites le 14 nov. Planches Position et Carte : lot 8.
   - 14 nov. (suite) : bouton « changer de caméra » replacé (IconButton pose son style sur la vue intérieure : envelopper dans une vue positionnée) ; recadrage refait avec redressement fin (`angle` dans `Crop`, `straightenScale`), pas pour la photo de profil (recadrage natif sans angle).
   - Nouvelles planches à valider sur le canevas (rangées 4 et 5) : `ReglagesApparence`, `ReglagesNotifications`, `ReglagesStockage`, `ReglagesConfidentialite`, `ReglagesSauvegarde`, `ReglagesMisesAJour` (une page par catégorie, au lieu de tout renvoyer aux Paramètres), `ProfilContactOptions` (6 actions : Écrire, Rechercher, Personnaliser, Ma position, Couper le son, Éphémères ; Bloquer / Supprimer ; médias en 4 filtres), `MenuTroisPoints` (liste d'actions qui s'ouvre depuis le bouton), `Decouvrir` (même feuille que les Nouveautés, 4 pages). À coder après validation. Le réglage « Vibrations » de la planche Notifications n'existe pas encore dans l'app.
11. [ ] Gestes encore en PanResponder à passer sur gesture-handler + Reanimated : `useSwipeReply`, `useVoiceRecorder`.

### Vague 5 — Appels audio et vidéo [natif] — modèle gros, mode plan

- Même connexion WebRTC et même signalisation chiffrée. Sonnerie par push `call` (plein écran Notifee).
- Sans TURN : si la connexion directe est impossible, afficher « Appel impossible sur ce réseau » au lieu de sonner dans le vide.
- Ordre : audio, puis vidéo, puis bascule de caméra et mode haut-parleur.

### Vague 6 — Groupes — modèle gros, mode plan

- 10 personnes au plus. Chaque message est chiffré une fois par membre avec les sessions à deux existantes (pas de nouveau protocole).
- Envoi direct aux membres connectés, par push aux autres. Pas d'appels de groupe.
- À concevoir en entier avant d'écrire une ligne : ajout et départ d'un membre, ordre des messages, médias.



## 5. Limites connues, à garder en tête

- **Firebase gratuit** : environ 100 connexions simultanées à la base (à vérifier). C'est le plafond d'utilisateurs en ligne en même temps tant que la signalisation y passe.
- **Sans TURN**, certaines connexions directes échouent (réseaux mobiles) : messages par push et fichiers par relais prennent le relais, les appels non.
- **Si des dons arrivent un jour**, ordre des dépenses utiles : d'abord le palier Firebase qui lève le plafond de connexions, ensuite un serveur TURN (appels fiables partout). Les deux se branchent par la configuration distante signée, sans nouvel APK.
- **Google voit les métadonnées des pushs** (qui réveille qui, quand), jamais le contenu. L'écran 3.6 doit le dire honnêtement.
