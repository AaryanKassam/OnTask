import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useTheme } from '@/components/ui';
import { load, onAppStateChange, useData } from '@/lib/store';

// Connects to the computer and watches the app going to the background.
function Engine() {
  const { joinedId, remote, settings } = useData();

  useEffect(() => {
    load();
    const sub = AppState.addEventListener('change', onAppStateChange);
    return () => sub.remove();
  }, []);

  // Keep the screen on while following a focus block, so the phone can sit
  // on the desk as the timer.
  const session = remote.hub?.session;
  const awake = settings.keepAwake && !!session && session.id === joinedId && session.timer?.phase !== 'break';
  useEffect(() => {
    if (!awake) return;
    activateKeepAwakeAsync('focus').catch(() => {});
    return () => {
      Promise.resolve(deactivateKeepAwake('focus')).catch(() => {});
    };
  }, [awake]);

  return null;
}

export default function RootLayout() {
  const t = useTheme();
  return (
    <>
      <Engine />
      <StatusBar style="auto" />
      <Stack screenOptions={{ contentStyle: { backgroundColor: t.bg }, headerStyle: { backgroundColor: t.card }, headerTintColor: t.fg }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ presentation: 'modal', title: 'Settings' }} />
      </Stack>
    </>
  );
}
