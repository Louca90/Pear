// Tous les réglages de Pear au même endroit. Rien ici n'est secret.
//
// Ce qui touche au protocole ou à la cryptographie (contextes de chiffrement, tailles de clés, format des
// morceaux de fichier) reste dans son module : le changer casserait la compatibilité avec les téléphones
// déjà installés.

const KB = 1024;
const MB = 1024 * KB;
const SECOND = 1000;
const MINUTE = 60 * SECOND;

// --- Serveurs ---

// Fonction Vercel qui réveille le téléphone du destinataire (voir DOCS_SERVEUR.md).
export const WAKE_URL = 'https://pear-drab.vercel.app/api/wake';

// STUN aide chaque téléphone à découvrir son adresse publique. Plusieurs serveurs en cas de panne.
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// Configuration distante signée (voir src/remoteConfig/parse.ts) : elle peut remplacer WAKE_URL et
// ICE_SERVERS sans nouvel APK. Les valeurs ci-dessus restent celles par défaut si elle est injoignable.
export const REMOTE_CONFIG_URL = 'https://raw.githubusercontent.com/Louca90/Pear/main/config/remote-config.json';
// Clé publique Ed25519 de signature ; la clé privée est hors du dépôt (scripts/sign-config.mjs).
export const REMOTE_CONFIG_PUBLIC_KEY = '84740cf7b9d167c8b9878958c4bfc6d2a410104213cc7c043e4098de07770b73';
export const REMOTE_CONFIG_TIMEOUT_MS = 10 * SECOND;

// Mises à jour : la dernière release du dépôt GitHub (voir RELEASE.md).
export const LATEST_RELEASE_URL = 'https://api.github.com/repos/Louca90/Pear/releases/latest';
export const RELEASES_PAGE = 'https://github.com/Louca90/Pear/releases/tag/';
// Au premier plan, GitHub n'est pas interrogé plus souvent que ça.
export const UPDATE_CHECK_INTERVAL_MS = 5 * MINUTE;
export const UPDATE_CHECK_TIMEOUT_MS = 10 * SECOND;

// --- Connexion entre téléphones ---

// Battement de coeur : sans signe de l'autre téléphone pendant PEER_TIMEOUT_MS, la connexion est morte.
export const HEARTBEAT_MS = 4 * SECOND;
// Conversation : messages lus par pages (à l'ouverture, puis à chaque approche du haut).
export const MESSAGE_PAGE_SIZE = 40;
export const PEER_TIMEOUT_MS = 12 * SECOND;
// Laisse à une négociation le temps d'aboutir avant d'en relancer une, même sur un réseau lent.
export const RETRY_MS = 20 * SECOND;
// Au-delà, une offre de connexion ne sert plus à rien : le téléphone qui l'a envoyée a déjà réessayé.
export const SIGNAL_MAX_AGE_MS = 2 * MINUTE;
// Evite d'afficher "hors ligne" pendant une micro-coupure, par exemple en passant du Wi-Fi à la 5G.
export const OFFLINE_DELAY_MS = 1 * SECOND;
// Backpressure : au-delà, on attend que le réseau ait vidé la file avant d'envoyer la suite.
export const MAX_BUFFERED_BYTES = 1 * MB;
export const DRAIN_POLL_MS = 20;

// --- Réveil ---

// Android pénalise les pushs trop fréquents : on réveille un même contact au plus une fois par minute.
export const WAKE_INTERVAL_MS = 1 * MINUTE;
export const WAKE_CHECK_MS = 15 * SECOND;
// Android laisse environ 20 secondes à l'app réveillée par un push.
export const BACKGROUND_MAX_AWAKE_MS = 18 * SECOND;
export const BACKGROUND_QUIET_MS = 4 * SECOND;

// --- Fichiers ---

// Limite d'environ 16 Ko par message DataChannel : on garde de la place pour l'en-tête et le chiffrement.
export const CHUNK_BYTES = 14 * KB;
export const MAX_FILE_BYTES = 2 * 1024 * MB;
// Contrôle de flux : l'envoyeur ne prend pas plus d'avance que ça sur ce que le receveur a écrit.
// Sans ça, le receveur est débordé : il ne répond plus aux battements de coeur et paraît hors ligne.
export const SEND_WINDOW_CHUNKS = 128;
export const WINDOW_POLL_MS = 10;
// Le disque est sollicité par paquets : un accès par morceau de 14 Ko ralentirait tout le transfert.
export const DISK_BATCH_CHUNKS = 32;
export const PROGRESS_NOTIFY_MS = 500;

// Ce qu'un contact peut nous envoyer sans rien demander. Au-delà, on demande (ou on refuse pour la
// photo de profil et le fond d'écran, qui arrivent sans qu'on les voie passer).
export const AUTO_ACCEPT_BYTES = {
  avatar: 2 * MB,
  wallpaper: 10 * MB,
  image: 25 * MB,
  audio: 25 * MB,
  video: 100 * MB,
  file: 25 * MB,
};
// Fichiers en cours de réception chez un même contact : au-delà, même un petit fichier attend notre accord.
export const PENDING_QUOTA_BYTES = 300 * MB;

// --- Messages ---

export const MAX_TEXT_LENGTH = 2000;
export const MAX_PROFILE_NAME_LENGTH = 40;
// Une réaction reste courte : un emoji peut compter plusieurs caractères, pas plus.
export const MAX_REACTION_LENGTH = 16;
export const MAX_SAVED_ID_LENGTH = 64;
// Double ratchet : messages sautés qu'on accepte de rattraper, et clés gardées pour eux.
export const MAX_SKIP = 1000;
export const MAX_STORED_SKIPPED = 200;

// --- Médias ---

// Débit des vidéos filmées et de l'incrustation du texte : une vidéo retouchée ne regonfle pas.
export const VIDEO_BITRATE = 2_500_000;
export const PROFILE_PHOTO_QUALITY = 0.7;

// --- Notifications ---

export const NOTIFICATION_CHANNEL_ID = 'messages';
export const NOTIFICATION_SMALL_ICON = 'ic_launcher_monochrome';

// --- Journal ---

export const LOG_MAX_LINES = 500;

// --- Stockage : ne jamais changer, sinon les données déjà enregistrées ne sont plus retrouvées ---

export const DB_NAME = 'pear.db';
export const IDENTITY_KEY = 'identity';
export const CONTACTS_KEY = 'contacts';
export const RATCHET_PREFIX = 'ratchet.';
export const LOG_FILE = 'pear-log.txt';
