import { Platform } from 'react-native';
import notifee, { AuthorizationStatus } from '@notifee/react-native';

import { getSetting, setSetting } from './chat/database';
import { NOTIFICATION_CHANNEL_ID } from './config';
import { log } from './log';

// Ce qui permet de comprendre pourquoi une notification n'est pas arrivée (écran Diagnostic).

const LAST_PUSH = 'last_push';

// Appelé à chaque push reçu (réveil ou message), app ouverte ou fermée.
export function recordPush(type: string) {
  try {
    setSetting(LAST_PUSH, JSON.stringify({ at: Date.now(), type }));
  } catch (e) {
    log.warn('diagnostic', e);
  }
}

export type Diagnostics = {
  notificationsAllowed: boolean;
  channelBlocked: boolean;
  batteryRestricted: boolean;
  // Réglage propre au constructeur (démarrage automatique, mise en veille des apps), s'il existe.
  powerManager: boolean;
  manufacturer: string;
  lastPush: { at: number; type: string } | null;
  inboxRegistered: boolean;
  tokenPublished: boolean;
};

function readJson<T>(key: string): T | null {
  try {
    const saved = getSetting(key);
    return saved ? (JSON.parse(saved) as T) : null;
  } catch {
    return null;
  }
}

export async function collectDiagnostics(): Promise<Diagnostics> {
  const [settings, channelBlocked, batteryRestricted, power] = await Promise.all([
    notifee.getNotificationSettings(),
    notifee.isChannelBlocked(NOTIFICATION_CHANNEL_ID).catch(() => false),
    notifee.isBatteryOptimizationEnabled().catch(() => false),
    notifee.getPowerManagerInfo().catch(() => null),
  ]);
  const published = readJson<Record<string, unknown>>('tokens_published');
  return {
    notificationsAllowed: settings.authorizationStatus === AuthorizationStatus.AUTHORIZED,
    channelBlocked,
    batteryRestricted,
    powerManager: Boolean(power?.activity),
    manufacturer: String((Platform.constants as { Manufacturer?: string }).Manufacturer ?? power?.manufacturer ?? ''),
    lastPush: readJson(LAST_PUSH),
    inboxRegistered: readJson('inbox') !== null,
    tokenPublished: published !== null && Object.keys(published).length > 0,
  };
}

// Constructeurs connus pour arrêter les apps en arrière-plan : il faut autoriser Pear à la main.
const AGGRESSIVE = ['xiaomi', 'redmi', 'poco', 'oppo', 'realme', 'oneplus', 'huawei', 'honor', 'vivo', 'samsung', 'meizu', 'asus'];

export function needsManufacturerAdvice(manufacturer: string) {
  return AGGRESSIVE.includes(manufacturer.toLowerCase());
}

export function openBatterySettings() {
  return notifee.openBatteryOptimizationSettings();
}

export function openPowerManagerSettings() {
  return notifee.openPowerManagerSettings();
}

export function openNotificationSettings() {
  return notifee.openNotificationSettings();
}
