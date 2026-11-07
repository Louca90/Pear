import { registerRootComponent } from 'expo';
import notifee from '@notifee/react-native';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';

import App from './App';
import { installErrorHandlers } from './src/errors';
import { handleWake } from './src/chat/background';
import { handleNotificationEvent } from './src/chat/notificationActions';

// Avant tout le reste : une erreur au démarrage doit aussi finir dans le journal.
installErrorHandlers();

// Ces deux gestionnaires doivent être enregistrés ici, en dehors de tout écran :
// Android peut lancer l'app en arrière-plan sans jamais afficher App.
setBackgroundMessageHandler(getMessaging(), handleWake);
// App en arrière-plan ou fermée : l'appui sur une notification ou sur « Répondre » arrive ici, pas dans App.
notifee.onBackgroundEvent(handleNotificationEvent);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
