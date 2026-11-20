import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';

import { getSetting, setSetting } from '../../chat/database';
import { log } from '../../log';

// Sons de la conversation (lot 3.4) : un son discret à l'envoi et à la réception, seulement quand la
// conversation est ouverte. Activés par défaut, coupés dans les Paramètres. Aucun son en mode
// silencieux ou vibreur, comme les autres messageries (le réglage le dit).
const SOURCES = {
  sent: require('../../../assets/sounds/sent.wav'),
  received: require('../../../assets/sounds/received.wav'),
  // Appels : tonalité d'attente de l'appelant, appel reconnecté, appel raccroché (Kenney, CC0).
  callWaiting: require('../../../assets/sounds/kenney_bong_001.wav'),
  callReconnected: require('../../../assets/sounds/kenney_confirmation_001.wav'),
  callHangup: require('../../../assets/sounds/kenney_close_001.wav'),
};
type Sound = keyof typeof SOURCES;

const players: Partial<Record<Sound, AudioPlayer>> = {};

// Les sons d'appel suivent le volume de sonnerie et le mode silencieux du téléphone, sans passer par
// l'interrupteur « Sons de la conversation ».
const CALL_SOUNDS: Sound[] = ['callWaiting', 'callReconnected', 'callHangup'];

export function soundsEnabled() {
  return getSetting('chat_sounds') !== '0';
}

export function setSoundsEnabled(value: boolean) {
  setSetting('chat_sounds', value ? null : '0');
}

// Précharge les lecteurs à l'ouverture d'une conversation : un lecteur créé juste avant de jouer n'a
// pas encore chargé son fichier et le premier son était perdu.
export function prepareSounds() {
  for (const sound of Object.keys(SOURCES) as Sound[]) {
    try {
      players[sound] ??= createAudioPlayer(SOURCES[sound]);
    } catch (e) {
      log.warn('sons', e);
    }
  }
}

// Libère les lecteurs en quittant la conversation.
export function releaseSounds() {
  for (const sound of Object.keys(players) as Sound[]) {
    try {
      players[sound]?.remove();
    } catch (e) {
      log.warn('sons', e);
    }
    delete players[sound];
  }
}

// Le mode audio est remis avant chaque son, car les vocaux et les appels le changent : le son se mêle
// à la musique en cours sans l'interrompre et se tait en mode silencieux ou vibreur.
export function playSound(sound: Sound) {
  if (!CALL_SOUNDS.includes(sound) && !soundsEnabled()) return;
  prepareSounds();
  setAudioModeAsync({ interruptionMode: 'mixWithOthers', playsInSilentMode: false, allowsRecording: false })
    .catch((e) => log.warn('sons', e))
    .finally(() => {
      const player = players[sound];
      if (!player) return;
      try {
        player.volume = 0.6;
        player.seekTo(0).catch((e) => log.warn('sons', e));
        player.play();
      } catch (e) {
        log.warn('sons', e);
      }
    });
}
