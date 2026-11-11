import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';

import { getSetting, setSetting } from '../../chat/database';
import { log } from '../../log';

// Sons de la conversation (lot 3.4) : un son discret à l'envoi et à la réception, seulement quand la
// conversation est ouverte. Activés par défaut, coupés dans les Paramètres.
const SOURCES = {
  sent: require('../../../assets/sounds/sent.wav'),
  received: require('../../../assets/sounds/received.wav'),
};
type Sound = keyof typeof SOURCES;

const players: Partial<Record<Sound, AudioPlayer>> = {};

export function soundsEnabled() {
  return getSetting('chat_sounds') !== '0';
}

export function setSoundsEnabled(value: boolean) {
  setSetting('chat_sounds', value ? null : '0');
}

// Le son se mêle à la musique en cours sans l'interrompre, et se tait en mode silencieux ou vibreur.
export function playSound(sound: Sound) {
  if (!soundsEnabled()) return;
  setAudioModeAsync({ interruptionMode: 'mixWithOthers', playsInSilentMode: false })
    .then(() => {
      const player = (players[sound] ??= createAudioPlayer(SOURCES[sound]));
      player.volume = 0.6;
      player.seekTo(0).catch((e) => log.warn('sons', e));
      player.play();
    })
    .catch((e) => log.warn('sons', e));
}
