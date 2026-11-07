# Journal des versions

## 1.5.0 (versionCode 7)

### Résumé

- Nouvel appareil photo : il s'ouvre plus vite, filtres en direct à faire défiler autour du déclencheur, zoom ×0,5 / ×1 / ×2, et on peut changer de caméra sans arrêter la vidéo.
- Éditeur façon Snap : filtres, textes, stickers, dessin, recadrage, et pour les vidéos découpe, son et vitesse.
- Sauvegarde chiffrée par mot de passe pour changer de téléphone, ou juste ton profil.
- Partage tes photos et vidéos vers Pear depuis la galerie.
- Pear parle maintenant 7 langues, et la liste des conversations est plus claire.

### Détails

#### Nouveautés

- Appareil photo refait sur CameraX : préparé dès le lancement de l'app, gardé allumé 15 s après l'avoir quitté, photo et vidéo prêtes ensemble.
- Filtres en direct dans l'appareil photo : bande de pastilles autour du déclencheur, aperçu filtré tout de suite ; Heure, Date et Pellicule visibles avant la prise.
- Zoom réel : ×0,6 sur les téléphones à caméra multiple, objectif ultra grand-angle sinon ; zoom en glissant le déclencheur vers le haut en filmant.
- Changer de caméra en filmant sans arrêter la vidéo (deux petits appuis d'un second doigt, ou double appui une fois verrouillée).
- Éditeur : 13 filtres et réglages (luminosité, contraste, saturation, température), textes (5 polices, 10 couleurs, fonds, déplacer, pincer, tourner), stickers, dessin avec gomme et annuler, recadrage et rotation (Libre, 1:1, 4:5, 3:4, 9:16, 16:9).
- Vidéo : découpe du début et de la fin sur une frise, son coupé, vitesse ×0,5 à ×2.
- Sauvegarde : exporter et charger son profil, ou une sauvegarde complète (identité, contacts, conversations, médias en option), protégée par mot de passe ; restauration depuis la prise en main.
- Partage vers Pear depuis la galerie ou une autre app, à un ou plusieurs contacts.
- 7 langues : français, anglais, espagnol, allemand, italien, portugais, néerlandais.
- Liste des conversations : non-lus, recherche, catégories, conversations épinglées, « Envoyé / Reçu il y a ».
- Onglet Contacts (annuaire, mon QR code, scanner), glissement entre onglets.
- Dans une conversation : messages épinglés, transfert, envoi programmé, liens cliquables, réponses et likes animés, bulles regroupées avec photo, chargement par pages et barre de défilement.
- Page Stockage (vider le cache, supprimer les médias d'une conversation, nettoyage automatique), profil d'un contact avec ses médias, couleurs des bulles à la roue.
- Notifications coupées par type (photos, vidéos, vocaux, fichiers) ; demandes acceptées ou refusées depuis la notification.

#### Corrections

- Retour en arrière plus fluide, sans image de l'ancien écran.
- Photo de profil et fond d'écran choisis dans la galerie de Pear.
- Réaction qui ne cache plus l'heure d'une photo, feuille de langue lisible en sombre, icônes de la barre du bas redessinées.

#### Technique

- Module natif PearCamera (CameraX 1.6) : zoom par rapport réel, choix de l'objectif, enregistrement persistant ; photo tournée et réduite en un seul passage.
- Retouches vidéo Media3 (couleurs, calque, découpe, son, vitesse) et captureView pour l'export exact de l'éditeur.
- Sauvegardes : Argon2id, morceaux XChaCha20-Poly1305 authentifiés et numérotés, restauration vérifiée puis appliquée au démarrage.
- Migrations SQLite 7 à 11, sans perte.

## 1.4.0 (versionCode 6)

### Résumé

- Nouvelle prise en main : quelques écrans pour régler les autorisations, ton profil et ton thème.
- Un seul scan suffit pour ajouter quelqu'un : il reçoit une demande et l'accepte depuis la cloche.
- Ton profil a son onglet dans la barre du bas, les réglages sont derrière l'engrenage.
- Photos et vidéos arrivent même quand vous n'êtes pas connectés en même temps.
- Retour en arrière plus doux, en fondu.

### Détails

#### Nouveautés

- Prise en main : bienvenue, autorisations (notifications, caméra, batterie, installation), profil et thème ; faite une fois par tout le monde, nom et photo préremplis.
- Pairing à sens unique : demande chiffrée envoyée après un scan, contact « en attente » jusqu'à l'acceptation, scans croisés acceptés tout seuls.
- Cloche et page Demandes (accepter, refuser, bloquer) ; contacts bloqués dans les Paramètres.
- Onglet Profil avec ta photo ; page Paramètres (apparence, notifications, diagnostic, bloqués, mises à jour).
- QR code et lien avec ton pseudo ; « Montrer mon code » s'ouvre par-dessus sans perdre le contact scanné.
- Relais chiffré des photos, vidéos et fichiers (25 Mo au plus) quand la connexion directe est impossible.
- Retour en arrière en fondu, fluide aussi au bouton maintenu.

#### Corrections

- Plus de notification de réception pour la photo de profil ou le fond d'écran.
- Plus de rebond dans la barre du bas ; plus de voile blanc pendant le retour en thème sombre.
- Bandeau sur l'accueil si une autorisation a été retirée.

#### Technique

- Demandes de pairing scellées (libsodium) dans la boîte du destinataire, push sur son topic.
- Relais par la Realtime Database : réservation /api/relay, morceaux chiffrés de 512 Ko, budget mensuel, nettoyage quotidien.
- Fonctions natives de batterie (module maison), permission REQUEST_IGNORE_BATTERY_OPTIMIZATIONS.

## 1.3.0 (versionCode 5)

### Résumé

- Les messages arrivent même quand Pear est fermé : ils voyagent chiffrés dans la notification.
- Tu peux répondre ou marquer comme lu directement depuis la notification.
- Nouveau thème sombre (ou automatique) dans ton profil.
- Un écran « Diagnostic des notifications » aide à comprendre quand un message tarde.
- Chiffrement renforcé : tes conversations passent sur des clés neuves, sans rien perdre.

### Détails

#### Nouveautés

- Message chiffré dans le push : notification immédiate app fermée, accusés de réception par push, réveil ciblé sur la bonne conversation.
- Notifications au style messagerie (photo du contact, derniers messages), réponse et « Marquer comme lu » depuis la notification, progression des fichiers reçus.
- Thème clair, sombre ou automatique, avec fondu au changement ; pas d'éclair blanc au lancement en mode sombre.
- Écran Diagnostic (notifications, batterie, réglage du constructeur, adresse de notification, dernier push, connexions, export du journal).
- Sessions v2 à clés éphémères : les contacts existants y passent d'eux-mêmes, sans perte ; les téléphones en 1.2.0 restent en v1.
- « Mets à jour Pear pour lire ce message » si un contact utilise une version plus récente.

#### Corrections

- Plus de bande de fond d'écran sous la zone de saisie ni sous la barre de navigation.
- La sélection d'un message, clavier ouvert, part de la bonne position.
- Messages système lisibles sur un fond d'écran en mode sombre.

#### Technique

- Contacts déplacés du coffre vers la base locale (migration 6, recopie vérifiée) ; état du ratchet dans la base chiffrée.
- Token de notification chiffré publié dans Firebase pour chaque contact, relu après un token périmé.
- Connexions directes limitées à 8, gardées 45 s après un envoi.
- Boîtes et demandes de pairing côté serveur (préparation du lot 5), nettoyage quotidien, version du protocole dans chaque message.
- Configuration distante signée, textes dans src/i18n/fr.ts, journal local, écran d'erreur, limites des fichiers reçus, ESLint et CI.

## 1.2.0 (versionCode 4)

### Résumé

- Toucher une notification ouvre directement la bonne conversation, même quand Pear est en arrière-plan.
- La conversation descend toute seule quand tu envoies, et un bouton « nouveaux messages » apparaît si tu es remonté.
- Les messages ne sont marqués « lus » qu'une fois que tu es redescendu les voir.
- Photos et vidéos s'ouvrent instantanément ; un appui long permet d'y réagir.
- Plusieurs bugs corrigés : barre du haut après le déverrouillage, messages très longs, envois de fichiers bloqués.

### Détails

#### Nouveautés

- Défilement automatique à l'envoi, bouton « N nouveaux messages » quand on est remonté.
- Accusés de lecture envoyés seulement une fois en bas de la conversation.
- Sélection d'un message très long : il se replie pour tenir à l'écran, réactions et actions toujours visibles.
- Ouverture immédiate des photos et vidéos ; le like d'un média passe par l'appui long.

#### Corrections

- Barre du haut mal placée quand l'app est ouverte depuis l'écran verrouillé.
- Notification touchée app en arrière-plan : la conversation ne s'ouvrait pas.
- Glisser pour répondre après une ouverture depuis une notification.
- Envoi de fichier bloqué en boucle (taille annoncée plus grande que le fichier) : les envois en attente sont réparés.
- Effets d'appui carrés qui débordaient des lignes et des menus.
- Animations sans rebond, sélection qui ne passe plus sur la barre du haut ni sur la saisie.

#### Technique

- Marges système lues par le module natif et remesurées à chaque changement.

## 1.1.1 (versionCode 3)

### Résumé

- Version de test de la mise à jour automatique : si tu lis ceci, elle a marché.

### Détails

#### Technique

- Script de release : chemin complet de gradlew.bat sous Windows.
- Première mise à jour installée par l'app elle-même, depuis la release GitHub.

## 1.1.0 (versionCode 2)

### Résumé

- Pear se met maintenant à jour tout seul : plus besoin de réinstaller l'app à la main.
- Le code de l'app a été réorganisé pour préparer les prochaines nouveautés.

### Détails

#### Nouveautés

- Vérification de la dernière version sur GitHub au lancement et au retour dans l'app.
- Écran « Mise à jour disponible » : téléchargement avec progression, vérification de l'empreinte SHA-256, installation.
- Popup « Pear est à jour ! » au premier lancement après une mise à jour.
- Profil : version installée, « Rechercher une mise à jour », état de l'autorisation d'installation.

#### Technique

- Découpage de l'écran de conversation et du moteur des conversations en petits modules.
- Tests automatiques (Jest) sur le formatage et la lecture des releases.
- Script de publication des versions (scripts/release.mjs).
