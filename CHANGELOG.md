# Journal des versions

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
