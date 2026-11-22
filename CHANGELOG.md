# Journal des versions

## 1.9.1 (versionCode 14)

### Résumé

- Répondre à un appel quand le téléphone est verrouillé ne fait plus planter Pear.
- Changer de langue ne fait plus planter Pear : l'app redémarre proprement dans la nouvelle langue.
- Le bouton du micro ne disparaît plus pendant un appel.
- Après une mise à jour, les nouveautés s'ouvrent en grand, avec une petite démo pour chacune.
- La mise à jour se télécharge avec une vraie barre de progression, et la notification « Pear est disponible » marche désormais app fermée.

### Détails

#### Nouveautés

- Après une mise à jour, les nouveautés de la 1.9 s'ouvrent en grand : la poire des transferts, le partage d'écran, le nouveau vocal, le statut d'envoi.
- Écran de mise à jour : une barre de progression sous le pourcentage, pleine pendant la vérification et l'installation.

#### Corrections

- Appels : décrocher téléphone verrouillé, ou depuis la notification, faisait planter Pear une dizaine de secondes plus tard.
- Appels : le bouton du micro devenait parfois invisible après plusieurs appels.
- Langue : changer de langue (et restaurer une sauvegarde) faisait planter la version publiée. L'app redémarre maintenant entièrement.
- Notification de mise à jour : elle ne s'affichait jamais quand Pear était fermé.
- Accueil : un seul bouton pour ajouter quelqu'un, le QR code (le « + » faisait la même chose).
- Appareil photo : le bouton « 1 » de la vue unique a la même icône que dans la galerie.

#### Technique

- Service d'appel : micro + caméra, puis micro, puis synchronisation (permis en arrière-plan) ; relancé en micro dès que Pear est à l'écran.
- Redémarrage complet de l'app au lieu de recharger le JavaScript à chaud.
- La version annoncée par push est vérifiée par `src/update/announce.ts` (testée). Une version corrective reprend les pages « Quoi de neuf » de sa version.
- Nouvel APK nécessaire (service d'appel et redémarrage natifs).

## 1.9.0 (versionCode 13)

### Résumé

- Nouvelle icône Pépins, une poire coupée en deux qui s'anime partout dans l'app : connexion, envoi d'une photo (elle se remplit avec le vrai pourcentage, puis « Vérifié »), tirer pour actualiser.
- Partage d'écran pendant un appel, avec zoom chez celui qui regarde. Les appels marchent aussi téléphone verrouillé, avec la bonne sortie audio (Bluetooth, casque) et son nom.
- Nouveau vocal : touchez le micro, mettez en pause, réécoutez, puis envoyez. Photo et vidéo en vue unique depuis l'appareil photo de Pear.
- La Carte devient un onglet et le QR code a sa feuille animée (Mon code / Scanner). Une position partagée affiche maintenant la vraie commune.
- « Envoi… » reste affiché tant que le téléphone de votre contact n'a pas reçu le message, et Pear vous dit s'il n'a pas de connexion.

### Détails

#### Nouveautés

- Icône Pépins : nouvelle icône de l'app (écran d'accueil d'Android, démarrage, notifications) et icône animée dans Pear, avec une version claire et une sombre selon le mode.
- Transferts : la poire remplace les barres de progression des photos, vidéos, fichiers et albums. Elle suit le vrai pourcentage, se remplit jusqu'en haut, puis passe à « Vérifié ».
- Partage d'écran pendant un appel audio ou vidéo (bouton en haut à droite). Android demande votre accord à chaque partage. Rien ne passe par un serveur : l'image suit le même chemin chiffré que la vidéo de l'appel.
- Chez celui qui regarde : l'écran partagé s'affiche en entier, on pince ou on touche deux fois pour zoomer, et un doigt déplace l'image zoomée.
- Appel : un appui au milieu masque ou remet les commandes. Le choix de la sortie audio affiche le nom de l'appareil (écouteurs Bluetooth, casque, USB).
- Vocal : un appui sur le micro enregistre, avec une barre animée (pause, arrêt, réécoute, envoi). Maintenir le micro marche toujours.
- Vue unique : bouton « 1 » à côté d'Envoyer pour une photo ou une vidéo prise avec l'appareil photo de Pear. Votre contact ne peut l'ouvrir qu'une fois.
- Onglet Carte à la place de Contacts. Le bouton QR code ouvre une feuille animée : Mon code et Scanner.
- Accueil : maintenir une conversation la soulève sur un fond flouté, et ses actions apparaissent une à une.
- Profil d'un contact : toucher sa photo l'affiche en grand.
- Position partagée : la commune la plus proche (« À Thonon-les-Bains », « Près de Reignier-Ésery ») au lieu de la grande ville à des dizaines de kilomètres. Tout se calcule sur le téléphone, avec une liste de lieux embarquée.
- Autorisations : plus de bandeau d'alerte. Une page Autorisations dans le Profil, et « Plus tard » sur chaque demande.

#### Corrections

- Statut d'envoi : « Envoi… » jusqu'à ce que le téléphone de votre contact ait reçu le message. Sans réponse après 30 secondes : « Envoi… · ton contact n'a pas de connexion ». Si c'est votre téléphone qui n'a pas de réseau : « Pas encore envoyé · tu n'as pas de connexion ».
- Accusés de lecture : un message ne reste plus « non lu » quand le suivant est lu. « Marquer comme lu » dans la notification marque vraiment la conversation comme lue, même app fermée.
- Appels : ils sonnent et s'affichent aussi quand le téléphone est verrouillé ou que Pear est fermé. La durée continue dans la fenêtre flottante, et la reconnexion après une coupure fonctionne.
- Glisser pour répondre : l'icône ne passe plus sur la photo de profil.
- Messages éphémères : le geste est plus difficile à déclencher par erreur, et les messages système sont plus discrets.
- Recherche : elle ne prend plus le clavier toute seule, même en revenant d'une conversation. Quitter une conversation ferme le clavier.
- Caméra : plus d'à-coup à l'ouverture.
- Carte : télécharger la carte de sa zone marche sans avoir partagé sa position avant (au lieu de « Position introuvable » sur certains téléphones).
- Plus de son à l'envoi ni à la réception d'un message (le réglage est retiré). Les sons d'appel restent.

#### Technique

- Programme testeur (Profil, Mises à jour) : les pré-versions signées sont proposées sans jamais bloquer l'app.
- Partage d'écran : service de capture MediaProjection de WebRTC, la piste de l'écran remplace celle de la caméra sans renégociation, et le partage ne reprend jamais tout seul après une reconnexion.
- Appels : perte de connexion détectée sur l'état ICE, chronomètre natif dans la fenêtre flottante, liste des sorties audio native.
- Accusés de lecture par curseur (« lu jusqu'à ce message »), renvoyé jusqu'à confirmation, aussi par push chiffré.
- Lieux : 28 000 communes de France et des pays voisins (GeoNames, CC BY 4.0), générées par `scripts/build-places.mjs`.
- Batterie : les minuteurs d'affichage de l'accueil et de la carte s'arrêtent en arrière-plan. Le journal note la taille, la durée et le débit de chaque fichier reçu.
- Sons d'appel : Kenney, CC0.
- Nouvel APK nécessaire (permissions, service d'appel, icônes système).

## 1.8.0 (versionCode 12)

### Résumé

- Appels audio et vidéo : deux boutons dans l'en-tête de la conversation. L'appel passe en direct entre les deux téléphones, chiffré, sans serveur au milieu.
- Si l'autre téléphone est fermé ou en veille, il sonne quand même, même verrouillé. Si la connexion directe est impossible, Pear le dit au lieu de sonner dans le vide.
- Quitter Pear pendant un appel garde l'appel dans une petite fenêtre flottante. En vidéo, déplacez votre image où vous voulez ; appuyez dessus pour l'échanger avec celle de l'autre.
- Les appels fonctionnent avec un casque Bluetooth ou filaire, et l'appel en cours apparaît dans la Now Bar des Samsung. Pour appeler quelqu'un, il faut que lui aussi ait la 1.8.0.

### Détails

#### Nouveautés

- Appel audio ou vidéo depuis l'en-tête d'une conversation. L'appelé reçoit un push qui le réveille et le connecte ; il ne sonne qu'une fois la connexion directe établie (sonnerie du téléphone, qui respecte le silencieux et le vibreur, et notification plein écran Répondre / Refuser par-dessus le verrouillage).
- Pendant l'appel : micro coupé, haut-parleur ou écouteur (l'écran s'éteint contre l'oreille), changement de caméra, caméra allumée ou coupée en cours d'appel. Quand l'autre allume sa caméra, Pear propose d'allumer la vôtre.
- Casque Bluetooth ou filaire : il prend le son automatiquement, et le son y bascule si vous le branchez en plein appel.
- Vidéo : l'image de l'autre en grand, la vôtre en vignette aux coins arrondis, que l'on déplace et qui se range dans le coin le plus proche.
- Quitter Pear pendant l'appel : fenêtre flottante d'Android (les deux caméras l'une sous l'autre en vidéo, la photo du contact en audio). La connexion directe reste ouverte pour que l'appel ne se coupe pas.
- Revenir dans Pear : l'appel se réduit en une pastille déplaçable, qui se range en haut ou en bas de l'écran.
- Appel en cours : notification au format appel d'Android avec la durée et Raccrocher, affichée dans la Now Bar des Samsung.
- Historique dans la conversation et sur l'accueil : « Appel audio · 3:07 », « Appel manqué » (en rouge), « Appel refusé », « Appel impossible sur ce réseau », et une notification pour un appel manqué.
- Textes des appels en français, anglais, espagnol, allemand, italien, portugais et néerlandais.

#### Corrections

- Aucune.

#### Technique

- Même connexion WebRTC que les messages : les pistes audio et vidéo y sont ajoutées et renégociées par le canal de données chiffré (seul le téléphone « a » propose). Invitation, réponse, fin d'appel passent par ce canal.
- Nouveau type de push `call` côté serveur (priorité haute, gardé 60 secondes), chiffré de bout en bout avec les clés des autres pushs.
- Module natif : son et sonnerie (`CallAudio.kt`), service de premier plan micro et caméra au format appel (`PearCallService.kt`), fenêtre flottante, vue vidéo aux coins arrondis dans une vue ordinaire (`PearVideoView.kt`).
- Nouvelles autorisations Android : service de premier plan micro et caméra, notification plein écran, réglage du son, notification mise en avant (Android 16). Aucune nouvelle bibliothèque.
- Sans serveur TURN : si la connexion directe est impossible, l'appel n'aboutit pas et le dit.

## 1.7.1 (versionCode 11)

### Résumé

- Un message qui n'est pas encore arrivé dit enfin ce qui se passe : « En attente du contact » avec l'heure du dernier essai, ou « Pas encore envoyé » si rien n'a pu partir.
- Après 5 minutes sans nouvelle, un bouton « Réessayer » apparaît sous le message. Aucune promesse de livraison : elle dépend du téléphone de votre contact.
- Un texte long arrive maintenant même si l'autre téléphone est éteint ou hors ligne, sans doublon.
- Un message renvoyé après une coupure n'est jamais reçu deux fois.

### Détails

#### Nouveautés

- Sous un message pas encore distribué : « Envoi… » (contact connecté), « En attente du contact · dernier essai 14:32 » (un essai est parti, on attend son téléphone) ou « Pas encore envoyé · pas de connexion » (rien n'a pu partir de chez vous). L'heure est absolue, elle ne se périme pas.
- Bouton « Réessayer » après 5 minutes sans essai, 3 essais au plus par heure. Appuyer sans réseau ne consomme rien.
- Texte trop long pour une notification chiffrée : il est déposé chiffré dans le relais, le contact le récupère à son réveil puis il est effacé du relais.

#### Corrections

- Un message renvoyé (accusé perdu, reconnexion, « Réessayer ») repart à l'identique : le chiffrement n'avance plus à chaque renvoi, ce qui évite d'user les clés du destinataire.
- Le destinataire reconnaît un message déjà reçu et renvoie seulement l'accusé, au lieu d'échouer à le déchiffrer une deuxième fois.
- Après un changement de session (mise à niveau du chiffrement, réparation de la conversation), les messages en attente sont rechiffrés avec la nouvelle session.
- Le texte d'aide de l'autorisation de position précise qu'elle est approximative et lue sur le téléphone.

#### Technique

- Base de données : migration 18 sans perte (dernier essai, nombre d'essais et paquet chiffré de chaque message, paquets déjà reçus, clé des textes du relais).
- Le serveur de réveil accepte un champ facultatif « quiet » (priorité normale). L'application ne l'utilise pas : en test, l'accusé en priorité normale arrivait trop tard.
- Aucune nouvelle dépendance native.

## 1.7.0 (versionCode 10)

### Résumé

- Pear change de look : accueil, conversation, réglages, profil, appareil photo et éditeur ont été entièrement redessinés, avec des animations plus douces partout.
- Nouvelle carte de vos proches, hors ligne et en clair ou sombre : leur position en direct, la vôtre, et « Envoyer seulement ma position actuelle ».
- Appareil photo plus rapide à ouvrir, envoi direct à un contact depuis une conversation, et photos « vue unique » en un geste.
- Conversations plus rapides à ouvrir, nouvelle sélection d'un message et bouton pour revenir en bas.

### Détails

#### Nouveautés

- Carte des contacts (MapLibre) : la zone autour de vous (25 km) se télécharge une fois puis reste sur le téléphone ; la carte n'utilise plus le réseau ensuite. Épingles à photo ou initiale qui dérivent à peine quand le partage est en direct, fiche du contact, mode discret qui arrête tous les partages. Carte claire ou sombre selon le thème.
- Position : partage « tant que l'app est ouverte », feuille d'envoi avec mini-carte, et « Envoyer seulement ma position actuelle » (sans suivi).
- Conversation : sélection d'un message refaite (le message monte, les réactions sortent du coin de la bulle, le menu se déplie ligne par ligne ; un texte trop long se replie pour tenir ; l'heure et les coches s'ouvrent au milieu d'un groupe).
- Conversation : bouton « revenir en bas » quand on est remonté, qui devient une pastille verte avec le nombre de nouveaux messages.
- Joindre : feuille avec les photos récentes, et tuiles Appareil (la photo part directement au contact), Fichier, Position, Une fois (vue unique), Stickers.
- Personnaliser la conversation : grand aperçu vivant, couleurs des bulles, roue de couleurs, fonds d'écran.
- Profil du contact : six actions (Écrire, Rechercher, Personnaliser, Ma position, Couper le son, Éphémères), onglet Médias.
- Réglages : une page par catégorie (Apparence, Notifications, Confidentialité, Sauvegarde, Mises à jour), verrou de l'app en interrupteur, page Stockage avec la place prise par type et par contact.
- Pop-ups, toasts et feuilles du bas redessinés ; icônes animées (envoi, micro, épingle, corbeille, cloche, verrou).
- Appareil photo : nouveau déclencheur, onglets Photo / Vidéo, recadrage avec redressement, éditeur photo et vidéo refait.
- Vocaux et lecteur vidéo refaits.

#### Corrections

- Appareil photo : un appui sur un outil de l'éditeur ajoutait un texte ; le bouton pour changer de caméra était mal placé.
- Contacts : le trait qui balayait le QR code gênait le scan, il est retiré.
- Conversation : reprendre le défilement après un arrêt ne bloquait plus ; le retour Réglages → Profil ne fait plus réapparaître la page une image.
- Les séries (flammes) sont retirées de toute l'app.

#### Technique

- Ouverture des conversations plus rapide : signaux du moteur regroupés une fois par image, bulles qui ne se redessinent plus pour rien, connexion et « lu » lancés après l'arrivée de la page.
- Appareil photo prêt plus vite : l'écran est préparé d'avance (caméra éteinte) et la caméra s'allume dès que le doigt touche l'onglet.
- Toutes les animations et les gestes passent par Reanimated et gesture-handler (fil de l'interface), sans rebond.
- Les filtres fun de l'appareil photo (suivi du visage MediaPipe, Apache 2.0) sont prêts mais pas encore activés ; la mention de licence est dans Réglages > Mises à jour > Licences.
- Nouvelles dépendances natives : MapLibre, MediaPipe Tasks Vision, CameraX Effects.

## 1.6.0 (versionCode 9)

### Résumé

- Messages éphémères et photos à vue unique : en bas d'une conversation, tirez vers le haut pour activer ou couper les messages qui s'effacent tout seuls.
- Recherche dans les messages, notes à moi-même, albums photo, stickers maison, aperçu des liens et vocaux avec forme d'onde et vitesse de lecture.
- Nouvelle interface : couleur poire, coches « lu » animées, bulle « écrit… », poire animée (tirer pour actualiser, transferts, écrans vides).
- Sécurité : verrou par empreinte, base de messages et fichiers chiffrés sur le téléphone, mises à jour signées.
- Pear est plus rapide à l'ouverture des conversations et de l'accueil.

### Détails

#### Nouveautés

- Messages éphémères : minuteur par conversation (1 heure, 1 jour, 1 semaine), activé ou coupé par les deux en tirant vers le haut en bas de la conversation ; un message l'annonce chez les deux, et les bulles éphémères sont cernées de pointillés.
- Photo ou vidéo à vue unique (bouton « 1 » dans la galerie de la conversation) : ouverte une seule fois, puis effacée des deux téléphones.
- Recherche de messages, dans une conversation (loupe) et partout depuis l'accueil, sans tenir compte des accents.
- Notes à moi-même : une conversation qui ne quitte jamais le téléphone.
- Albums : plusieurs photos envoyées ensemble s'affichent en grille.
- Stickers maison : découpez au doigt un sujet dans une photo, gardé sur le téléphone.
- Aperçu des liens (titre et image), préparé par l'expéditeur seulement ; désactivable dans Paramètres > Confidentialité.
- Vocaux : forme d'onde, vitesse ×1 / ×1,5 / ×2, reprise de la lecture, enchaînement des vocaux à la suite.
- Position en direct (15 min, 1 h, 8 h), envoyée seulement par la connexion directe.
- Miniature floue pendant la réception d'une photo ou d'une vidéo.
- Accueil : tirer vers le bas pour actualiser, glisser une ligne pour épingler ou marquer lu, anneau « en ligne » autour des photos, « écrit… » et « Brouillon : » dans la liste.
- Conversation : bulle « écrit… », date collante pendant le défilement, emoji seul en grand, sons d'envoi et de réception (désactivables), coches « lu » en couleur poire.
- La poire s'anime : elle mûrit pendant un transfert ou une mise à jour, se fait croquer quand on actualise, pousse une feuille pour un contact vérifié.
- « Quoi de neuf » après une mise à jour et « Découvrir Pear » dans les Paramètres, avec des démos animées.
- Filtres d'ambiance de la caméra : Heure, Date et Pellicule redessinés, nouveaux filtres Jour, Lieu, Série et Batterie.
- Menu Partager d'Android : les contacts récents apparaissent avec leur photo de profil.
- Paramètres : taille du texte (4 crans), écran « Ce que les serveurs voient », luminosité au maximum sur « Mon QR ».
- Verrou de l'app par empreinte ou code du téléphone, captures d'écran bloquées, clavier incognito.

#### Corrections

- Vocaux en thème sombre : bouton, barres et vitesse bien visibles sur toutes les couleurs de bulle.
- Fichier à accepter : carte compacte qui tient sur les petits écrans, et notification même quand il arrive pendant que Pear est fermé.
- « Brouillon : » sur l'accueil n'abîme plus le texte.
- Caméra : zoom et cadenas du déclencheur ne se déclenchent plus ensemble sur une diagonale.
- Conversation cassée : après 3 messages indéchiffrables, « Réparer la conversation » relance l'échange de clés.
- Mise à jour : après 3 échecs d'installation, « Continuer pour cette fois ».

#### Technique

- Base SQLite chiffrée (SQLCipher) et fichiers chiffrés sur le disque ; migrations 14 à 17 (recherche FTS5, `meta`, `album`, messages éphémères), sans perte.
- Release signée Ed25519 (versionCode + sha256) : une release sans signature valide est ignorée.
- Cache de lecture de la base, bulles et lignes de l'accueil mémoïsées.
- Gestes de tirage avec react-native-gesture-handler.
- Serveur : nettoyage réservé au cron, budget du relais borné.
- Natif : `batteryStatus`, `lastKnownLocation`, icônes rondes des raccourcis de partage.

## 1.5.1 (versionCode 8)

### Résumé

- La mise à jour ne s'arrête plus sur « Téléchargement refusé (504) » : elle réessaie toute seule.
- Caméra plus fiable : elle ne reste plus noire à l'ouverture, la photo est exactement l'image plein écran, et la caméra avant a un flash d'écran.
- Photo de profil recadrée en carré et tournée avant d'être enregistrée.
- Galerie de Pear bien plus rapide, et un nouveau menu pour joindre photos et fichiers.

### Détails

#### Nouveautés

- Flash de la caméra avant : l'écran s'allume en blanc à pleine luminosité pour la photo ; pour la vidéo, un cadre blanc doux éclaire le visage.
- Photo de profil : recadrage en carré (un cercle montre ce qui restera) et rotation, enregistrée dès « Terminé », dans le Profil comme à la prise en main.
- Pièces jointes : le rond du trombone s'allonge en pilule sur le champ de texte (Photos, Fichier) et le trombone devient une croix ; un appui ailleurs le referme.

#### Corrections

- Mise à jour : 3 essais en cas d'erreur 502/503/504 ou de coupure, reprise refusée = on repart de zéro, et des messages clairs au lieu du texte technique.
- Caméra qui restait noire et obligeait à changer d'onglet : l'ancien écran coupait la caméra du nouveau.
- Photo prise : recadrée comme l'aperçu plein écran, au lieu d'une photo en 3:4.
- Photo envoyée à plusieurs contacts depuis la caméra : plus de message d'erreur alors qu'elle était partie ; seuls les vrais échecs sont signalés, avec le nom du contact.
- Galerie : vignettes d'Android à la bonne taille au lieu des photos entières, et plus de photos en double en faisant défiler.
- Conversation : barre de défilement d'Android à la place de la barre maison.
- Demandes d'ajout : le code de vérification n'est plus affiché.
- Ombre des pastilles de filtre plus coupée, ligne soulevée pour épingler une conversation qui ne dépasse plus de l'écran.
- Photo de profil : plus d'écran noir après l'enregistrement, orientation des photos de la galerie respectée.

#### Technique

- Téléchargement natif en plusieurs essais (reprise par Range, 416 = repartir de zéro).
- PearCamera : aperçu et photo en 4:3, recadrage aux proportions de l'écran en un seul passage avec la rotation ; flash d'écran de CameraX (FLASH_MODE_SCREEN) ; chaque vue ne détache que ses propres usages, ouverture ratée relancée.
- Nouvelles fonctions natives : thumbnail (loadThumbnail en cache), cropImage et imageSize (EXIF), setScreenBrightness.

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
