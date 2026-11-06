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
- `rateLimits/caller/{uid}` et `rateLimits/target/{empreinte du token}` = `{ minute, count }` : un seul nœud par appelant et par destinataire, remis à zéro chaque minute. Écrits uniquement par le serveur (SDK admin) ; aucun client ne peut les lire ni les écrire.

### Règles de sécurité

Elles sont versionnées dans `database.rules.json` : tout est fermé par défaut ; dans `signals`, il faut être connecté, le salon doit avoir le bon format, on peut seulement créer un message bien formé (trois champs, `data` de 16 000 caractères au plus) ou le supprimer, jamais le modifier.

**Publier** : console Firebase → Realtime Database → Règles → coller le contenu de `database.rules.json` → Publier. (Ou `firebase deploy --only database` avec la CLI Firebase.)

**Vérifier après publication** :
1. Les deux téléphones se connectent toujours (statut « Connecté » dans une conversation).
2. Dans l'onglet Règles, le simulateur refuse : une lecture de `/signals` (sans salon), une écriture dans `/rateLimits`, une modification d'un message existant.

## Fonction `/api/wake`

- `POST` avec `Authorization: Bearer <jeton Firebase>` et un corps `{ "token": "<token FCM>" }`, rien d'autre.
- Réponses : `204` envoyé, `400` corps invalide, `401` jeton absent ou faux, `405` mauvaise méthode, `410` token FCM périmé, `429` trop d'appels, `502` échec FCM, `500` serveur mal configuré.
- Limites : 30 appels par minute par appelant, 20 par minute par destinataire. Les comptes anonymes pouvant être recréés à volonté, c'est la limite par destinataire qui protège un téléphone d'être bombardé. Si la base est injoignable, le réveil part quand même (la limite ne bloque jamais un vrai message).
- App Check n'est pas utilisé : la vérification « Play Integrity » de Google ne reconnaît pas un APK installé hors du Play Store.
- Test local, sans Firebase : `node server/test/wake.test.js`.

### Variables d'environnement Vercel (noms seulement)

- `FIREBASE_SERVICE_ACCOUNT` : clé JSON du compte de service Firebase (secrète).
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
