// Breaking a commitment lock takes deliberate effort: wait out a short delay,
// then retype a random code that only appears here.

import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Body, Button, Card, Field, Label, Screen, Title, useTheme } from '@/components/ui';
import { fmtDur } from '@/lib/format';
import { lockRemainingMs } from '@/lib/session';
import { endSession, liftLock, useData } from '@/lib/store';
import { useNow } from '@/lib/useNow';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L to mistype

function makeCode(): string {
  return Array.from({ length: 8 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
}

const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export default function OverrideScreen() {
  const t = useTheme();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const unlock = mode === 'unlock';
  const { session, settings } = useData();
  const [openedAt] = useState(() => Date.now());
  const [code] = useState(makeCode);
  const [typed, setTyped] = useState('');
  const now = useNow(250);

  if (!session) {
    return (
      <Screen>
        <Body>No session is running.</Body>
        <Button title="Close" onPress={() => router.back()} />
      </Screen>
    );
  }

  const waitMs = settings.overrideWaitSec * 1000 - (now - openedAt);
  const left = lockRemainingMs(session, now);
  const matches = normalize(typed) === code;

  return (
    <Screen>
      <Title sub={`You committed to ${session.lockMin} focused minutes. ${fmtDur(left)} to go.`}>{unlock ? 'Unlock break apps?' : 'End early?'}</Title>

      {waitMs > 0 ? (
        <Card tone="accent">
          <Body>Take a breath. If you still want to {unlock ? 'unlock' : 'stop'} in {Math.ceil(waitMs / 1000)} seconds, a code will appear here.</Body>
          <Body muted>The urge often passes in that time.</Body>
        </Card>
      ) : (
        <Card>
          <Label>Override code</Label>
          <Text selectable={false} style={{ fontSize: 34, letterSpacing: 6, fontWeight: '700', color: t.fg, fontVariant: ['tabular-nums'], textAlign: 'center' }}>
            {code.slice(0, 4)} {code.slice(4)}
          </Text>
          <Field label="Type the code" autoCapitalize="characters" autoCorrect={false} autoComplete="off" value={typed} onChangeText={setTyped} />
        </Card>
      )}

      <Button
        title={unlock ? 'Unlock' : 'End session'}
        disabled={waitMs > 0 || !matches}
        onPress={() => {
          if (unlock) liftLock();
          else endSession(true);
          router.back();
        }}
      />
      <Button kind="ghost" title="Keep going" onPress={() => router.back()} />
    </Screen>
  );
}
