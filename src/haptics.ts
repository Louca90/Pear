import * as Haptics from 'expo-haptics';

import { log } from './log';

// Les seules vibrations de l'app. Jamais sur un simple défilement ni à l'ouverture d'un écran.
// - select (léger) : changement d'onglet, de filtre, seuil d'un glissement ;
// - action (moyen) : envoi, verrouillage de l'enregistrement, épinglage, appui long ;
// - success / error : scan réussi, contact vérifié, échec d'envoi.
const warn = (e: unknown) => log.warn('vibration', e);

export const haptics = {
  select() {
    Haptics.selectionAsync().catch(warn);
  },
  action() {
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press).catch(warn);
  },
  success() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(warn);
  },
  error() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(warn);
  },
};
