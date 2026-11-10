// Partagé par server/api/relay.js (réservation) et server/api/cleanup.js (budget rendu au nettoyage).

// Morceau en clair ; chiffré puis en base64, il reste sous 700 000 caractères (limite des règles).
const CHUNK_BYTES = 512 * 1024;

// Mois du compteur de budget (`relayUsage/{AAAA-MM}`) pour une date en millisecondes.
const monthOf = (at) => new Date(at).toISOString().slice(0, 7);

module.exports = { CHUNK_BYTES, monthOf };
