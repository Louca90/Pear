import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';

import { log } from '../../log';

// Sons des appels : tonalité d'attente de l'appelant, appel reconnecté, appel raccroché (Kenney, CC0).
// Plus de son à l'envoi ni à la réception d'un message (retiré à la demande de Louca, 20/11).
// Ils suivent le volume et le mode silencieux du téléphone.
const SOURCES = {
  callWaiting: require('../../../assets/sounds/kenney_bong_001.wav'),
  callReconnected: require('../../../assets/sounds/kenney_confirmation_001.wav'),
  callHangup: require('../../../assets/sounds/kenney_close_001.wav'),
};
type Sound = keyof typeof SOURCES;

const players: Partial<Record<Sound, AudioPlayer>> = {};

// Un lecteur créé juste avant de jouer n'a pas encore chargé son fichier : au premier son d'un appel,
// on les crée tous (ils sont prêts pour la suite) et on les garde.
function prepare() {
  for (const sound of Object.keys(SOURCES) as Sound[]) {
    try {
      players[sound] ??= createAudioPlayer(SOURCES[sound]);
    } catch (e) {
      log.warn('sons', e);
    }
  }
}

// Le mode audio est remis avant chaque son, car les vocaux et les appels le changent : le son se mêle
// à ce qui joue sans l'interrompre et se tait en mode silencieux ou vibreur.
export function playSound(sound: Sound) {
  prepare();
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
