// Sound, vibration and scheduled notifications. Notifications are what make
// alerts work while OnTask is in the background; in the foreground the app
// plays its own chime instead, so foreground notifications are silenced.

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const native = Platform.OS !== 'web';
const CHANNEL = 'focus-alerts';

let player: AudioPlayer | null = null;

// The "Back OnTask" button on reminders. Expo Go can't show notification
// buttons, but tapping the notification itself does the same thing.
export const BACK_CATEGORY = 'back-ontask';

export async function setupAlerts(): Promise<void> {
  if (native) {
    await Notifications.setNotificationCategoryAsync(BACK_CATEGORY, [
      { identifier: 'back', buttonTitle: 'Back OnTask', options: { opensAppToForeground: true } },
    ]).catch(() => {});
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: false,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Focus alerts',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 200, 120, 200],
      });
    }
  }
  await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {});
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!native) return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  return asked.granted;
}

export async function scheduleAt(id: string, at: number, title: string, body: string, sound = true, back = false): Promise<void> {
  if (!native) return;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  if (at <= Date.now() + 1000) return;
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title, body, ...(sound ? { sound: 'default' } : {}), ...(back ? { categoryIdentifier: BACK_CATEGORY, data: { backOnTask: true } } : {}) },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), channelId: CHANNEL },
  }).catch(() => {});
}

export async function notifyNow(title: string, body: string, sound = true): Promise<void> {
  if (!native) return;
  await Notifications.scheduleNotificationAsync({
    content: { title, body, ...(sound ? { sound: 'default' } : {}) },
    trigger: null,
  }).catch(() => {});
}

export async function cancel(...ids: string[]): Promise<void> {
  if (!native) return;
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
}

// Tapping a reminder (or its Back OnTask button) sends you back.
export function onBackOnTask(handler: () => void): () => void {
  if (!native) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    if (response.notification.request.content.data?.backOnTask) handler();
  });
  return () => sub.remove();
}

export function chime(): void {
  try {
    player ??= createAudioPlayer(require('../../assets/sounds/chime.wav'));
    player.seekTo(0);
    player.play();
  } catch {
    // Audio can fail (e.g. web before any user gesture); the alert still shows.
  }
}

export function buzz(kind: 'alert' | 'tap' = 'alert'): void {
  if (!native) return;
  if (kind === 'tap') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}
