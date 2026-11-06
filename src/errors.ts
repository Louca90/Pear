import { log } from './log';

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsType = { getGlobalHandler: () => GlobalHandler; setGlobalHandler: (handler: GlobalHandler) => void };
type HermesType = { enablePromiseRejectionTracker?: (options: { allRejections: boolean; onUnhandled: (id: number, error: unknown) => void }) => void };

// Toute erreur non rattrapée, y compris hors de l'affichage (réseau, arrière-plan), finit dans le journal.
// Le comportement habituel de React Native est conservé : on ajoute seulement une trace.
export function installErrorHandlers() {
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsType }).ErrorUtils;
  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      log.error(isFatal ? 'erreur fatale' : 'erreur non rattrapée', error);
      previous(error, isFatal);
    });
  }
  // Une promesse rejetée sans .catch ne fait rien planter, mais on veut la voir dans le journal.
  const hermes = (globalThis as { HermesInternal?: HermesType }).HermesInternal;
  hermes?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_id, error) => log.error('promesse rejetée', error),
  });
}
