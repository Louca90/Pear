# Serveurs de Pear

Les serveurs ne voient jamais le contenu des messages : tout ce qui y passe est chiffré de bout en bout, et la plupart des messages vont directement d'un téléphone à l'autre (WebRTC).

## Ce qui tourne où

| Service | Rôle | Plan |
|---|---|---|
| Firebase Authentication | Compte anonyme par installation (aucune donnée personnelle), exigé par les règles | Spark (gratuit) |
| Firebase Realtime Database | `signals/{salon}` : signalisation WebRTC chiffrée, supprimée après lecture. `rateLimits/` : compteurs du serveur de réveil | Spark (gratuit) |
| Firebase Cloud Messaging | Push « réveil » vide vers le téléphone du destinataire | gratuit |
| Vercel (`server/`, projet `pear`, adresse `pear-drab.vercel.app`) | `/api/wake` : vérifie le compte Firebase de l'appelant, applique les limites, envoie le push | Hobby (gratuit) |
| GitHub Releases | APK et notes de version, lus par la mise à jour automatique (voir `RELEASE.md`) | gratuit |

## Base de données (Realtime Database)

- `signals/{salon}/{id}` = `{ from: 'a' | 'b', data: <texte chiffré>, at: <horodatage> }`. Le salon (43 caractères) est dérivé du secret partagé par les deux contacts : impossible à deviner sans ce secret. Chaque message est supprimé par son destinataire après lecture, et par Firebase si l'expéditeur se déconnecte (`onDisconnect`).
- `inboxOwners/{inboxId}` = `{ uid, at }` : le compte Firebase qui possède la boîte de demandes de pairing. Écrit uniquement par `/api/inbox`, après une preuve de possession de la clé privée ; lisible seulement par ce compte.
- `requests/{inboxId}/{id}` = `{ v: 1, data: <boîte scellée libsodium, 2 Ko au plus>, at }` : demandes de pairing. Écrites uniquement par `/api/pair-request` ; le propriétaire de la boîte peut les lire et les supprimer, jamais les modifier. Supprimées après 7 jours (tâche quotidienne), et par l'app après lecture.
- `tokens/{inboxId}/{étiquette}` = `{ v: 1, data, at }` (lot 4) : le token FCM du propriétaire de la boîte, chiffré une fois par contact avec une clé tirée de leur secret partagé ; l'étiquette (22 caractères) est dérivée du même secret. Seul le propriétaire écrit (600 caractères au plus) ; la lecture se fait par le chemin exact, que seul le contact sait calculer, sans pouvoir lister la boîte. Republié au lancement si le token a changé ou date de plus de 30 jours, et à chaque renouvellement ; l'expéditeur le relit avant un push, surtout après un `410`. Supprimé quand le contact est supprimé, et par la tâche quotidienne au-delà de 60 jours. Environ 300 octets par contact.
- `rateLimits/{type}/{id}` = `{ minute, count }` : un seul nœud par appelant et par destinataire, remis à zéro chaque minute (`caller`, `target` pour le réveil ; `inboxCaller` ; `pairCaller`, `pairInbox`). Écrits uniquement par le serveur (SDK admin) ; aucun client ne peut les lire ni les écrire. La tâche quotidienne supprime les compteurs périmés.

### Calculs partagés avec l'app

- Clé publique : X25519, 32 octets en base64url sans remplissage (43 caractères).
- `inboxId` = les 32 premiers caractères du base64url de `SHA-256("pear-inbox-v1:" + clé publique)`.
- Topic FCM des demandes : `pair_{inboxId}`. L'app s'y abonne au démarrage (lot 5) ; seul le serveur envoie aux topics.
- Preuve pour `/api/inbox` : `secret = X25519(clé privée du téléphone, serverKey)`, `clé = SHA-256(secret)`, `proof = base64url(HMAC-SHA256(clé, "pear-inbox-v1|{uid}|{clé publique}|{at}"))`, avec `at` l'heure en millisecondes (5 minutes d'écart au plus). `serverKey` est donnée par `GET /api/inbox`. Elle est dérivée de la clé de service Firebase : aucun secret de plus à configurer. Si la clé de service change, `serverKey` change et les téléphones refont leur enregistrement.

### Règles de sécurité

Elles sont versionnées dans `database.rules.json` : tout est fermé par défaut ; dans `signals`, il faut être connecté, le salon doit avoir le bon format, on peut seulement créer un message bien formé (trois champs, `data` de 16 000 caractères au plus) ou le supprimer, jamais le modifier.

**Publier** : console Firebase → Realtime Database → Règles → coller le contenu de `database.rules.json` → Publier. (Ou `firebase deploy --only database` avec la CLI Firebase.)

**Vérifier après publication** :
1. Les deux téléphones se connectent toujours (statut « Connecté » dans une conversation).
2. Dans l'onglet Règles, le simulateur refuse : une lecture de `/signals` (sans salon), une écriture dans `/rateLimits`, une modification d'un message existant.

## Fonction `/api/wake`

- `POST` avec `Authorization: Bearer <jeton Firebase>` et un corps `{ token, v?, type?, payload? }`. Les apps d'avant le lot 3 n'envoient que `{ token }` : c'est un réveil simple.
- `type` : `wake` (réveil, sans contenu, durée de vie 5 minutes), `msg` (texte chiffré dans `payload`, lot 4) ou `file` (fichier prêt à recevoir, lot 7), ces deux derniers gardés 7 jours par FCM si le téléphone est éteint. `payload` : base64, 3 500 caractères au plus (FCM limite un push à 4 Ko).
- Le push reçu est « data-only » : `{ type, v, payload? }`.
- Réponses : `204` envoyé, `400` corps invalide, `401` jeton absent ou faux, `405` mauvaise méthode, `410` token FCM périmé, `429` trop d'appels, `502` échec FCM, `500` serveur mal configuré.
- Limites : 30 appels par minute par appelant, 20 par minute par destinataire. Les comptes anonymes pouvant être recréés à volonté, c'est la limite par destinataire qui protège un téléphone d'être bombardé. Si la base est injoignable, le réveil part quand même (la limite ne bloque jamais un vrai message).
- App Check n'est pas utilisé : la vérification « Play Integrity » de Google ne reconnaît pas un APK installé hors du Play Store.
- Test local, sans Firebase : `node server/test/wake.test.js`.

## Fonctions de pairing (lot 3)

- `GET /api/inbox` → `{ v, serverKey }`. `POST /api/inbox` `{ v: 1, publicKey, at, proof }` → `{ v, inboxId }` : enregistre la boîte, ou la reprend après une réinstallation (même clé, nouveau compte anonyme). Réponses : `400` corps ou date invalide, `401`, `403` preuve fausse, `429` (10 par minute et par compte).
- `POST /api/pair-request` `{ v: 1, inboxId, sealed }` : dépose la demande et envoie un push `{ type: 'pair', v }` au topic du destinataire (gardé 7 jours). Réponses : `204`, `400`, `401`, `413` demande trop grosse, `429` (5 par minute et par expéditeur, 10 par minute et par boîte), `507` boîte pleine (50 demandes en attente).
- `GET /api/cleanup` : tâche quotidienne à 4 h UTC (`server/vercel.json`, gratuite sur le plan Hobby). Elle supprime les demandes, les jetons, les compteurs et les fichiers du relais périmés. Elle exige `Authorization: Bearer $CRON_SECRET` (Vercel l'envoie tout seul au cron quand la variable existe) et répond `401` sinon, y compris si `CRON_SECRET` n'est pas configurée. Elle ne lit aucun morceau de fichier : le relais est listé en `shallow=true` (API REST), puis seule la fiche `meta` de chaque fichier est lue.
- Pas de serveur TURN : les offres gratuites sans carte bancaire n'existent pas ou ne marchent pas. Sans connexion directe, les messages passent chiffrés dans les pushs, et les fichiers par le relais ci-dessous.

## Relais des fichiers (lot 7)

Quand le destinataire n'est pas joignable en direct depuis quelques secondes, l'app dépose le fichier chiffré dans la Realtime Database (gratuite, sans carte) :

- `POST /api/relay` `{ v: 1, size }` → `{ v, id, chunks, chunkBytes }`. Réserve l'envoi et crée `relay/{id}/meta` = `{ owner, size, chunks, slots, last, at }` (`slots` : `{ 0: true, …, chunks-1: true }` ; `last` : numéro du dernier morceau, en texte). Réponses : `400`, `401`, `413` (plus de 25 Mo : le fichier attend une connexion directe), `429` (20 envois par jour et par compte), `507` (budget du mois atteint).
- L'app écrit ensuite elle-même `relay/{id}/chunks/{n}` : 512 Ko en clair par morceau, chiffrés (XChaCha20-Poly1305, clé du fichier, contexte `pear-relay-v1.{id}.{n}`), puis en base64. Les règles n'autorisent que le propriétaire de la réservation, seulement les numéros présents dans `meta/slots`, 700 000 caractères par morceau, sans réécriture. Une fiche sans `slots` (réservée avant le 10 nov. 2026) garde l'ancienne règle ; ces fiches disparaissent en 7 jours, la clause pourra être retirée ensuite.
- La clé du fichier ne voyage que dans un message chiffré par le ratchet (événement `relay`), envoyé une fois tout le fichier en ligne. Le destinataire télécharge, déchiffre, puis supprime `relay/{id}` ; l'identifiant (128 bits aléatoires) sert de droit de lecture et de suppression. Un téléphone ne peut supprimer qu'un fichier complet (le morceau `meta/last` existe) : un envoi abandonné reste jusqu'au nettoyage, qui rend son budget.
- `relayUsage/{AAAA-MM}` compte les octets du mois : au-delà de 6 Go, le relais s'arrête. Le plafond gratuit de téléchargement (10 Go par mois) est partagé avec la signalisation, qui doit toujours passer. La taille est comptée dès la réservation (une rafale dans la journée ne dépasse pas le plafond), puis le nettoyage rend au mois de la réservation ce qui n'a jamais été envoyé.
- La tâche quotidienne supprime les fichiers de plus de 7 jours, et ceux de plus de 24 h jamais envoyés en entier (sans lire les morceaux, seulement leur liste en `shallow`).
- Mise en ligne : pousser le serveur (qui écrit `slots` et `last`) avant de publier `database.rules.json`.
- Tests : `node server/test/relay.test.js`.

**Tests des abus**, sans Firebase : `node server/test/pair.test.js` (aussi lancé par la CI). Cas couverts :

- quelqu'un qui connaît seulement la clé publique ne peut pas prendre la boîte ;
- une preuve trop vieille ou faite pour un autre compte est refusée ;
- le spam d'un même expéditeur, ou de plusieurs comptes vers une même boîte, est limité ;
- une demande trop grosse, ou envoyée sans jeton valide, est refusée ;
- une boîte pleine refuse les nouvelles demandes, et les demandes expirées libèrent la place ;
- le nettoyage quotidien supprime les demandes expirées et les compteurs périmés.

### Variables d'environnement Vercel (noms seulement)

- `FIREBASE_SERVICE_ACCOUNT` : clé JSON du compte de service Firebase (secrète).
- `CRON_SECRET` : chaîne aléatoire d'au moins 16 caractères, exigée par `/api/cleanup` (secrète). Sans elle, le nettoyage quotidien est refusé.
- `FIREBASE_DATABASE_URL` (facultative) : adresse de la Realtime Database, par défaut `https://pear-2c275-default-rtdb.europe-west1.firebasedatabase.app`.

**Déployer** : automatique. Le projet Vercel `pear` est relié au dépôt GitHub (dossier racine `server`) : chaque push sur `main` redéploie la fonction en production. Vérifier ensuite : un `POST` sans jeton sur `https://pear-drab.vercel.app/api/wake` répond `401`.

## Quotas gratuits et ce qui se passe au-delà

Chiffres vérifiés le 2026-11-06 ; ils peuvent changer.

| Quota | Limite | Usage de Pear | Au-delà |
|---|---|---|---|
| Realtime Database : connexions simultanées | **100** | une par app ouverte (signalisation) | les nouvelles connexions sont refusées : les téléphones ne se trouvent plus tant que d'autres ne se déconnectent pas |
| Realtime Database : stockage | 1 Go | quelques Ko (messages supprimés après lecture) | écritures refusées |
| Realtime Database : téléchargement | 10 Go par mois | quelques Ko par connexion | lectures refusées jusqu'au mois suivant |
| Vercel : appels de fonctions | 1 000 000 par mois | un par réveil (au plus un par minute et par contact) | le projet peut être suspendu, souvent 30 jours |
| Vercel : CPU actif | 4 h par mois | quelques millisecondes par appel | idem |
| FCM | sans limite payante | — | — |

**La limite qui arrivera en premier est celle des 100 connexions simultanées de Firebase.** Plan B, dans l'ordre :
1. Passer Firebase au plan Blaze (paiement à l'usage) : 200 000 connexions, et l'usage de Pear reste dans la tranche gratuite ou presque (quelques centimes). Une carte bancaire est demandée.
2. Ne garder la connexion à la base ouverte que pendant une tentative de connexion P2P, au lieu de tout le temps (lot 4, point 14).
3. Remplacer la signalisation Firebase par une autre (fonction Vercel avec stockage, ou serveur WebSocket).

Sources : [limites Realtime Database](https://firebase.google.com/docs/database/usage/limits), [tarifs Firebase](https://firebase.google.com/pricing), [plan Hobby de Vercel](https://vercel.com/docs/plans/hobby), [limites Vercel](https://vercel.com/docs/limits).
