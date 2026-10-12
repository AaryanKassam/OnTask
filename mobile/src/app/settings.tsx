import { useState } from 'react';
import { Platform } from 'react-native';
import { LockSteps } from '@/components/LockSteps';
import { Body, Button, Card, Field, Label, Row, Screen, Toggle } from '@/components/ui';
import { updateSettings, useData } from '@/lib/store';

const STATUS_TEXT: Record<string, string> = {
  off: 'Not connected.',
  connecting: 'Connecting…',
  connected: 'Connected to your computer.',
  disconnected: 'Can’t reach your computer. Is the companion running, and are you on the same Wi-Fi?',
  error: 'Wrong pairing code.',
};

export default function SettingsScreen() {
  const { loaded } = useData();
  // The fields start from saved settings, so wait until they've loaded.
  return loaded ? <SettingsForm /> : <Screen>{null}</Screen>;
}

function SettingsForm() {
  const { settings, remote } = useData();
  const [host, setHost] = useState(settings.companionHost);
  const [code, setCode] = useState(settings.companionCode);
  const paired = !!settings.companionHost && !!settings.companionCode;
  const hub = remote.hub;

  return (
    <Screen>
      <Card>
        <Label>Your computer</Label>
        <Body muted style={{ fontSize: 13 }}>
          Run the companion on your Mac (cd companion, then npm start). It prints an address and a pairing code to enter here.
        </Body>
        <Field label="Computer address" placeholder="e.g. 192.168.1.20" value={host} onChangeText={setHost} autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" />
        <Field label="Pairing code" placeholder="e.g. K7Q4MX" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} />
        <Body muted style={{ fontSize: 13 }}>
          {remote.status === 'error' ? remote.detail || STATUS_TEXT.error : STATUS_TEXT[remote.status]}
          {hub ? ` Chrome ${hub.devices.extension ? 'linked' : 'not linked'}. Screen watching ${['watching', 'idle'].includes(hub.watcher.status) ? 'on' : 'off'}.` : ''}
        </Body>
        <Row>
          <Button flex title={paired ? 'Reconnect' : 'Connect'} disabled={!host.trim() || !code.trim()} onPress={() => updateSettings({ companionHost: host.trim(), companionCode: code.trim() })} />
          {paired ? (
            <Button
              flex
              kind="secondary"
              title="Disconnect"
              onPress={() => {
                setHost('');
                setCode('');
                updateSettings({ companionHost: '', companionCode: '' });
              }}
            />
          ) : null}
        </Row>
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
