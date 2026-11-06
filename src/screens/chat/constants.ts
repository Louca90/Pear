import { Easing } from 'react-native';

import { RouteType } from '../../network/peer';

export const DOUBLE_TAP_MS = 230;
export const LIKE = '❤️';
// En deçà de cette distance du bas, on considère qu'on lit les derniers messages.
export const AT_BOTTOM_PX = 80;
// Le temps qu'une photo ou une vidéo envoyée prenne sa hauteur finale dans la liste.
export const MEDIA_SETTLE_MS = 350;
export const LONG_PRESS_MS = 350;
export const EMOJI_COLUMNS = 8;
// Place réservée autour du message sélectionné : les réactions au-dessus, les actions en dessous.
export const REACTIONS_HEIGHT = 56;
export const ACTION_HEIGHT = 48;
export const SELECTION_GAP = 12;
export const SELECTION_TOP = 72;
// Hauteur d'une ligne de texte dans une bulle, et de ce qui l'entoure (marges, citation, heure, réactions).
export const TEXT_LINE_HEIGHT = 22;
export const BUBBLE_CHROME_HEIGHT = 110;
export const SELECTION_CLOSE_MS = 170;
// Glisser pour répondre : le geste démarre après SWIPE_START, et répond à partir de SWIPE_REPLY.
export const SWIPE_START = 12;
export const SWIPE_REPLY = 56;
export const SWIPE_MAX = 76;
export const JUMP_PULSE_DELAY_MS = 350;
// Plein écran : au-delà de cette distance ou de cette vitesse vers le bas, le glissé ferme.
export const VIEWER_CLOSE_DISTANCE = 110;
export const VIEWER_CLOSE_SPEED = 1;
export const VIEWER_DRAG_START = 10;
export const VIEWER_MIN_SCALE = 0.55;
export const VIEWER_OPEN_MS = 300;
export const VIEWER_CLOSE_MS = 240;
export const VIEWER_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
export const COMPOSER_FADE_HEIGHT = 140;
export const ATTACH_CLOSE_MS = 140;
export const TOAST_VISIBLE_MS = 1800;
// Vocal : lâcher avant ce temps ne l'envoie pas. Glisser à gauche l'annule, vers le haut le verrouille.
export const VOICE_MIN_MS = 700;
export const VOICE_CANCEL_DISTANCE = 110;
export const VOICE_LOCK_DISTANCE = 90;
export const SEEK_THUMB_SIZE = 16;
export const VOICE_DOT_MS = 600;
// Une courbe douce plutôt qu'une ligne droite : on ne voit pas où le dégradé commence.
export const COMPOSER_FADE_STOPS = [[0, 0], [0.25, 0.08], [0.5, 0.3], [0.75, 0.68], [1, 1]];

export const ROUTE: Record<RouteType, string> = {
  host: 'Connecté, sur le même réseau',
  srflx: 'Connecté, direct par internet',
  relay: 'Connecté, par un serveur relais',
};
