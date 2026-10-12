// Pair this phone with a computer, once. The QR code in Chrome opens this
// screen with everything filled in; you just name the phone.

import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { Body, Button, Card, Field, Label, Row, Screen, Title } from '@/components/ui';
import * as store from '@/lib/store';

const DEFAULT_NAME = Platform.OS === 'android' ? 'My Android phone' : 'My iPhone';

export default function PairScreen() {
  const params = useLocalSearchParams();
  const { loaded } = store.useData();
  if (!loaded) return <Screen>{null}</Screen>;
  return <Pair initial={store.parsePairingLink(params)} />;
}

function Pair({ initial }: { initial: store.PairingLink | null }) {
  const { pairing, remote, settings } = store.useData();
  const known = !!initial && store.isSameComputer(initial);
  useEffect(() => {
    if (initial && known) {
      store.refreshAddress(initial);
      router.replace('/');
    }
  }, [initial, known]);
  const [link, setLink] = useState(initial);
  const [name, setName] = useState(settings.computer?.phoneName ?? DEFAULT_NAME);
  const [mode, setMode] = useState<'choose' | 'scan' | 'manual'>('choose');

  // Done: paired and connected.
  if (settings.computer && !pairing && remote.status === 'connected') {
    return (
      <Screen>
        <Title sub={`This phone is “${settings.computer.phoneName}”. They’ll find each other on their own from now on, even when the Wi-Fi changes the address.`}>
          Paired with {settings.computer.name}
        </Title>
        <Button title="Done" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  // Pairing in progress, or it failed.
  if (pairing) {
    const failed = remote.status === 'error' || remote.status === 'disconnected';
    return (
      <Screen>
        <Title>{failed ? 'Couldn’t pair' : `Pairing with ${pairing.computerName}…`}</Title>
        {failed ? (
          <Card tone="warn">
            <Body>
              {remote.status === 'error'
                ? 'The pairing code didn’t match. Open Pair a phone in Chrome and scan the new code.'
                : `Can’t reach ${pairing.computerName}. Check that both are on the same Wi-Fi and that Chrome is open on the computer.`}
            </Body>
            <Button
              kind="secondary"
              title="Try again"
              onPress={() => {
                store.cancelPairing();
                setLink(null);
                setMode('choose');
              }}
            />
          </Card>
        ) : null}
      </Screen>
    );
  }

  // Have a pairing link: just name the phone.
  if (link) {
    return (
      <Screen>
        <Title sub="Do this once. After that your phone and computer remember each other.">Pair with {link.computerName}</Title>
        <Field label="Name this phone" value={name} onChangeText={setName} placeholder={DEFAULT_NAME} autoFocus />
        <Body muted style={{ fontSize: 13 }}>
          This is how it shows up in Chrome.
        </Body>
        <Button title="Pair" disabled={!name.trim()} onPress={() => store.pairWith(link, name)} />
        <Button kind="ghost" title="Cancel" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </Screen>
    );
  }

  if (mode === 'scan') return <Scanner onLink={setLink} onCancel={() => setMode('choose')} />;
  if (mode === 'manual') return <Manual onLink={setLink} onCancel={() => setMode('choose')} />;

  return (
    <Screen>
      <Title sub="In Chrome, click the OnTask icon → Settings → Pair a phone. A QR code appears.">Pair with your computer</Title>
      <Body muted>Scanning it with your phone’s Camera app opens OnTask and fills everything in. Or scan it from here:</Body>
      <Button title="Scan the QR code" onPress={() => setMode('scan')} />
      <Button kind="secondary" title="Pair manually" onPress={() => setMode('manual')} />
    </Screen>
  );
}

function Scanner({ onLink, onCancel }: { onLink: (l: store.PairingLink) => void; onCancel: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [bad, setBad] = useState(false);
  if (!permission) return <Screen>{null}</Screen>;
  if (!permission.granted) {
    return (
      <Screen>
        <Title sub="OnTask only uses the camera to read the pairing code.">Allow the camera</Title>
        <Button title="Allow" onPress={requestPermission} />
        <Button kind="ghost" title="Back" onPress={onCancel} />
      </Screen>
    );
  }
  return (
    <Screen>
      <Title sub="Point it at the QR code in Chrome.">Scan the pairing code</Title>
      <View style={{ height: 340, borderRadius: 16, overflow: 'hidden' }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            const link = store.pairingLinkFromUrl(data);
            if (link) onLink(link);
            else setBad(true);
          }}
        />
      </View>
      {bad ? <Body muted>That QR code isn’t an OnTask pairing code.</Body> : null}
      <Button kind="ghost" title="Back" onPress={onCancel} />
    </Screen>
  );
}

function Manual({ onLink, onCancel }: { onLink: (l: store.PairingLink) => void; onCancel: () => void }) {
  const [host, setHost] = useState('');
  const [code, setCode] = useState('');
  const go = () => {
    const h = host.trim();
    const isIp = /^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(h);
    onLink({ host: isIp ? '' : h, ip: isIp ? h : '', port: 4517, code: code.trim(), computerName: 'your computer' });
  };
  return (
    <Screen>
      <Title sub="Shown under Pair a phone in Chrome.">Pair manually</Title>
      <Card>
        <Label>Computer</Label>
        <Field label="Address" placeholder="e.g. Aaryans-MacBook-Air.local" value={host} onChangeText={setHost} autoCapitalize="none" autoCorrect={false} />
        <Field label="Pairing code" placeholder="e.g. K7Q4MX" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} />
      </Card>
      <Row>
        <Button flex title="Next" disabled={!host.trim() || !code.trim()} onPress={go} />
        <Button flex kind="secondary" title="Back" onPress={onCancel} />
      </Row>
    </Screen>
  );
}
