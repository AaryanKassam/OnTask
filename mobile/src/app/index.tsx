// The whole app on one screen. It follows the session the computer is
// running: the same task and timer, a place to park stray thoughts, and the
// apps you've earned at break time.

import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { TimerRing } from '@/components/TimerRing';
import { Body, Button, Card, Field, Label, Row, Screen, Title, useTheme } from '@/components/ui';
import { LockSteps } from '@/components/LockSteps';
import { fmtClock } from '@/lib/format';
import * as store from '@/lib/store';
import type { HubState } from '@/lib/sync';
import { useNow } from '@/lib/useNow';

const BREAK_APPS = [
  { name: 'TikTok', ios: 'snssdk1233://', web: 'https://www.tiktok.com/' },
  { name: 'YouTube', ios: 'youtube://', web: 'https://www.youtube.com/' },
  { name: 'Instagram', ios: 'instagram://', web: 'https://www.instagram.com/' },
  { name: 'X', ios: 'twitter://', web: 'https://x.com/' },
];

async function openApp(app: (typeof BREAK_APPS)[number]) {
  if (Platform.OS === 'ios') {
    try {
      await Linking.openURL(app.ios);
      return;
    } catch {
      // not installed: fall through to the website
    }
  }
  // On Android the https link opens the app when it's installed.
  await Linking.openURL(app.web).catch(() => {});
}

export default function Home() {
  const data = store.useData();
  if (!data.loaded) return <Screen>{null}</Screen>;
  const { settings, remote, joinedId, declinedId, lastEnded, notice, active } = data;
  const session = remote.hub?.session ?? null;
  const computer = settings.computer;

  let body;
  if (!computer) body = <NotPaired notice={notice} />;
  else if (remote.status !== 'connected') body = <Looking name={computer.name} />;
  else if (!active) body = <SwitchedOff phoneName={computer.phoneName} computerName={computer.name} />;
  else if (session && session.id === joinedId) body = <Following hub={remote.hub!} />;
  else if (session && session.id !== declinedId) body = <Offer task={session.task} />;
  else body = <Waiting />;

  return (
    <Screen>
      <Header subtitle={computer && remote.status === 'connected' ? `Connected to ${computer.name}` : undefined} />
      {body}
      {lastEnded && !(session && session.id === joinedId) ? <Ended summary={lastEnded} /> : null}
    </Screen>
  );
}

function Header({ subtitle }: { subtitle?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Title sub={subtitle}>OnTask</Title>
      <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => router.push('/settings')} hitSlop={12} style={{ padding: 6 }}>
        <Ionicons name="settings-outline" size={24} color={t.muted} />
      </Pressable>
    </View>
  );
}

function NotPaired({ notice }: { notice: string | null }) {
  return (
    <Card tone="accent">
      <Label>Pair with your computer</Label>
      {notice ? <Body>{notice}</Body> : null}
      <Body>OnTask on your phone follows the session you start in Chrome. Pair once and they’ll find each other from then on.</Body>
      <Button title="Pair" onPress={() => router.push('/pair')} />
    </Card>
  );
}

function SwitchedOff({ phoneName, computerName }: { phoneName: string; computerName: string }) {
  return (
    <Card>
      <Label>Switched off</Label>
      <Body>
        “{phoneName}” is paired with {computerName} but switched off, so it won’t follow sessions. Turn it on in Chrome: OnTask icon → Paired devices → Manage.
      </Body>
    </Card>
  );
}

function Looking({ name }: { name: string }) {
  return (
    <Card>
      <Label>Looking for {name}</Label>
      <Body muted>Make sure Chrome is open on it and you’re on the same Wi-Fi. This connects on its own as soon as it can.</Body>
    </Card>
  );
}

function Waiting() {
  return (
    <Card>
      <Label>Waiting for your computer</Label>
      <Body muted>Start OnTask in Chrome. When it knows what you’re working on, it’ll show up here.</Body>
    </Card>
  );
}

function Offer({ task }: { task: string }) {
  return (
    <Card tone="accent">
      <Label>You started OnTask on your computer</Label>
      <Body style={{ fontWeight: '600', fontSize: 18 }}>{task}</Body>
      <Body muted>Follow along here to get the timer, break alerts and a place to park thoughts.</Body>
      <Row>
        <Button flex title="Connect" onPress={store.join} />
        <Button flex kind="secondary" title="Not now" onPress={store.decline} />
      </Row>
    </Card>
  );
}

function Ended({ summary }: { summary: { task: string; thoughts: store.Thought[]; pickups: number } }) {
  const open = summary.thoughts.filter((t) => !t.done);
  return (
    <Card>
      <Label>Session ended</Label>
      <Body style={{ fontWeight: '600' }}>{summary.task}</Body>
      <Body muted>
        {summary.pickups} phone pickup{summary.pickups === 1 ? '' : 's'}
      </Body>
      {open.length ? (
        <View style={{ gap: 4 }}>
          <Body muted>Thoughts you parked:</Body>
          {open.map((t, i) => (
            <Body key={i}>• {t.text}</Body>
          ))}
        </View>
      ) : null}
      <Button kind="ghost" title="Dismiss" onPress={store.dismissSummary} />
    </Card>
  );
}

// --- following a session ----------------------------------------------------

function Following({ hub }: { hub: HubState }) {
  const t = useTheme();
  const now = useNow(500);
  const { thoughts, pickups, settings } = store.useData();
  const s = hub.session!;
  const timer = s.timer;
  const onBreak = timer?.phase === 'break';

  let big: string;
  let small: string;
  let progress = 0;
  if (timer && timer.endsAt !== null && timer.phaseStartedAt !== null) {
    const left = Math.max(0, timer.endsAt - now);
    big = fmtClock(left);
    small = 'left';
    progress = Math.min(1, (now - timer.phaseStartedAt) / (timer.endsAt - timer.phaseStartedAt));
  } else {
    // Flowtime focus, or no timer: count up.
    big = fmtClock(now - (timer?.phaseStartedAt ?? s.startedAt));
    small = 'focused so far';
  }
  const heading = onBreak ? (timer!.isLong ? 'Long break' : 'Break') : timer ? `Focus · block ${timer.blocksDone + 1}` : 'Focus';
  const screen = hub.watcher.status === 'watching' ? hub.screen : null;

  return (
    <View style={{ gap: 14 }}>
      <View style={{ alignItems: 'center', gap: 4 }}>
        <Label>{heading}</Label>
        <Text style={{ fontSize: 20, fontWeight: '600', color: t.fg, textAlign: 'center' }}>{s.task}</Text>
      </View>

      <TimerRing progress={progress} color={onBreak ? t.warn : t.accent}>
        <Text style={{ fontSize: 56, fontWeight: '300', color: t.fg, fontVariant: ['tabular-nums'] }}>{big}</Text>
        <Text style={{ color: t.muted, fontSize: 14 }}>{small}</Text>
      </TimerRing>

      {screen ? (
        <Body muted style={{ textAlign: 'center' }}>
          Computer: {screen.activity} · {screen.verdict === 'on' ? 'on task' : screen.verdict === 'off' ? 'off task' : 'unclear'}
        </Body>
      ) : null}

      {onBreak ? <BreakApps /> : null}
      <Thoughts thoughts={thoughts} />
      {!onBreak && !settings.lockTipSeen ? <LockTip /> : null}

      <Body muted style={{ textAlign: 'center' }}>
        {pickups} phone pickup{pickups === 1 ? '' : 's'} · the timer is set in Chrome
      </Body>
      <Button kind="ghost" title="Stop following on this phone" onPress={store.leave} />
    </View>
  );
}

function BreakApps() {
  return (
    <Card tone="accent">
      <Label>On your break</Label>
      <Body muted>Go ahead. OnTask will call you back when the break ends.</Body>
      <Row gap={8}>
        {BREAK_APPS.map((app) => (
          <Button key={app.name} kind="secondary" title={app.name} onPress={() => openApp(app)} />
        ))}
      </Row>
    </Card>
  );
}

function Thoughts({ thoughts }: { thoughts: store.Thought[] }) {
  const t = useTheme();
  const [text, setText] = useState('');
  const save = () => {
    if (text.trim()) store.parkThought(text.trim());
    setText('');
  };
  return (
    <Card>
      <Field
        label="Park a thought"
        placeholder="Something popped into your head? Write it here."
        value={text}
        onChangeText={setText}
        onSubmitEditing={save}
        returnKeyType="done"
        hint="Writing it down lets your mind drop it. Deal with it on your break."
      />
      {text.trim() ? <Button title="Save" onPress={save} /> : null}
      {thoughts.map((th, i) => (
        <Pressable
          key={i}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: th.done }}
          onPress={() => store.toggleThought(i)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}
        >
          <Ionicons name={th.done ? 'checkbox' : 'square-outline'} size={22} color={th.done ? t.accentText : t.muted} />
          <Body style={{ flex: 1, textDecorationLine: th.done ? 'line-through' : 'none', color: th.done ? t.muted : t.fg }}>{th.text}</Body>
        </Pressable>
      ))}
    </Card>
  );
}

function LockTip() {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <Label>Lock your phone to OnTask</Label>
      <Body muted>
        Your phone can keep you inside OnTask until you enter a code. {Platform.OS === 'ios' ? 'It’s called Guided Access.' : 'It’s called app pinning.'}
      </Body>
      {open ? <LockSteps /> : null}
      <Row>
        <Button flex kind="secondary" title={open ? 'Hide steps' : 'Show me how'} onPress={() => setOpen(!open)} />
        <Button flex kind="ghost" title="Got it" onPress={() => store.updateSettings({ lockTipSeen: true })} />
      </Row>
    </Card>
  );
}

