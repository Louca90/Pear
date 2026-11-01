import { registerRootComponent } from 'expo';
import notifee from '@notifee/react-native';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';

import App from './App';
import { handleWake } from './src/chat/background';

// Ces deux gestionnaires doivent être enregistrés ici, en dehors de tout écran :
// Android peut lancer l'app en arrière-plan sans jamais afficher App.
setBackgroundMessageHandler(getMessaging(), handleWake);
notifee.onBackgroundEvent(async () => undefined);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
