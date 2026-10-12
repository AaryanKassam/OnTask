import { useState } from 'react';
import { Platform } from 'react-native';
import { LockSteps } from '@/components/LockSteps';
import { Body, Button, Card, Label, Row, Screen, Toggle } from '@/components/ui';
import { router } from 'expo-router';
import { unpair, updateSettings, useData } from '@/lib/store';

export default function SettingsScreen() {
  const { loaded } = useData();
  return loaded ? <SettingsForm /> : <Screen>{null}</Screen>;
}

function SettingsForm() {
  const { settings, remote } = useData();
  const [confirm, setConfirm] = useState(false);
  const c = settings.computer;
  const hub = remote.hub;

  return (
    <Screen>
      <Card>
        <Label>Your computer</Label>
        {c ? (
          <>
            <Body style={{ fontWeight: '600' }}>{c.name}</Body>
            <Body muted style={{ fontSize: 13 }}>
              This phone is “{c.phoneName}”. {remote.status === 'connected' ? 'Connected.' : 'Not connected right now. It reconnects on its own when Chrome is open on the computer and you’re on the same Wi-Fi.'}
              {hub ? ` Screen watching ${['watching', 'idle'].includes(hub.watcher.status) ? 'on' : 'off'}.` : ''}
            </Body>
            {confirm ? (
              <Row>
                <Button
                  flex
                  title="Unpair"
                  onPress={() => {
                    setConfirm(false);
                    unpair();
                  }}
                />
                <Button flex kind="secondary" title="Cancel" onPress={() => setConfirm(false)} />
              </Row>
            ) : (
              <Button kind="secondary" title="Unpair this phone" onPress={() => setConfirm(true)} />
            )}
          </>
        ) : (
          <>
            <Body muted>Not paired.</Body>
            <Button title="Pair with your computer" onPress={() => router.push('/pair')} />
          </>
        )}
      </Card>

      <Card>
        <Label>Alerts</Label>
        <Toggle label="Sounds" value={settings.sound} onValueChange={(sound) => updateSettings({ sound })} />
        <Toggle label="Vibration" value={settings.vibration} onValueChange={(vibration) => updateSettings({ vibration })} />
        <Toggle label="Keep the screen on during focus" value={settings.keepAwake} onValueChange={(keepAwake) => updateSettings({ keepAwake })} />
      </Card>

      <Card>
        <Label>{Platform.OS === 'android' ? 'Lock your phone to OnTask (app pinning)' : 'Lock your phone to OnTask (Guided Access)'}</Label>
        <LockSteps />
      </Card>

      <Body muted style={{ fontSize: 13 }}>
        Everything stays on your phone and your own computer. Nothing is sent to any online service.
      </Body>
    </Screen>
  );
}
