import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useTheme } from '@/components/ui';
import { load, onAppStateChange, tick, useData } from '@/lib/store';

// Runs the session clock and watches the app going to the background.
function Engine() {
  const { session, settings } = useData();

  useEffect(() => {
    load();
    const sub = AppState.addEventListener('change', onAppStateChange);
    const id = setInterval(() => tick(), 1000);
    return () => {
      sub.remove();
      clearInterval(id);
    };
  }, []);

  // Keep the screen on during focus so OnTask can sit on the desk as the timer.
  const awake = !!session && settings.keepAwake && session.phase === 'focus';
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
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="override" options={{ presentation: 'modal', title: 'Override' }} />
      </Stack>
    </>
  );
}
