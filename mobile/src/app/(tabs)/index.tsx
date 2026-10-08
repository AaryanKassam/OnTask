import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { TimerRing } from '@/components/TimerRing';
import { Body, Button, Card, Chip, Choice, Field, Label, Row, Screen, Title, useTheme } from '@/components/ui';
import { fmtClock, fmtDur } from '@/lib/format';
import { METHODS, resolveMethod } from '@/lib/methods';
import * as S from '@/lib/session';
import * as store from '@/lib/store';
import { useNow } from '@/lib/useNow';

const IF_THEN_IDEAS = [
  'put the phone face down and reread my last line',
  'park the thought and keep going',
  'take three slow breaths, then continue',
];

const MOVES = [
  'Walk to get a glass of water.',
  'Do ten squats or climb a flight of stairs.',
  'Stretch: reach up high, then touch your toes.',
  'Step outside for a minute of daylight.',
  'Look at something far away for 20 seconds, then walk around the room.',
];

const BREAK_APPS = [
  { name: 'Instagram', ios: 'instagram://', web: 'https://www.instagram.com/' },
  { name: 'YouTube', ios: 'youtube://', web: 'https://www.youtube.com/' },
  { name: 'TikTok', ios: 'snssdk1233://', web: 'https://www.tiktok.com/' },
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

export default function FocusScreen() {
  const { loaded, session } = store.useData();
  if (!loaded) return <Screen>{null}</Screen>;
  return session ? <SessionView s={session} /> : <Setup />;
}

// --- before a session -------------------------------------------------------

function Setup() {
  const { settings, lastSummary } = store.useData();
  const [task, setTask] = useState('');
  const [firstStep, setFirstStep] = useState('');
  const [ifThen, setIfThen] = useState('');
  const [methodId, setMethodId] = useState(settings.methodId);
  const [lockMin, setLockMin] = useState(settings.lockMin);
  const method = resolveMethod(methodId, { focusMin: settings.customFocusMin, breakMin: settings.customBreakMin });

  return (
    <Screen>
      <Title sub="Pick one thing. OnTask keeps time and notices when you drift.">OnTask</Title>
      {lastSummary ? <SummaryCard record={lastSummary} /> : null}

      <Field label="What are you working on?" placeholder="e.g. CS 246 assignment 3" value={task} onChangeText={setTask} />
      <Field
        label="First tiny step"
        placeholder="e.g. open the A3 handout"
        hint="Starting is the hardest part. Make it something you can do in two minutes."
        value={firstStep}
        onChangeText={setFirstStep}
      />

      <Choice
        label="Study method"
        options={METHODS.map((m) => ({ label: m.name, sub: m.id === 'custom' ? `${settings.customFocusMin} / ${settings.customBreakMin}` : m.short, value: m.id }))}
        value={methodId}
        onChange={setMethodId}
        hint={method.blurb}
      />

      <View style={{ gap: 8 }}>
        <Field
          label="If I get distracted, I will…"
          placeholder="Write your own, or pick one below"
          value={ifThen}
          onChangeText={setIfThen}
          hint="Deciding your response ahead of time makes you much more likely to follow through."
        />
        <Row gap={8}>
          {IF_THEN_IDEAS.map((idea) => (
            <Chip key={idea} label={idea} selected={ifThen === idea} onPress={() => setIfThen(idea)} />
          ))}
        </Row>
      </View>

      <Choice
        label="Commitment lock"
        options={[0, 25, 50, 90].map((m) => ({ label: m ? `${m} min` : 'Off', value: m }))}
        value={lockMin}
        onChange={setLockMin}
        hint={
          lockMin
            ? `Until you’ve focused ${lockMin} minutes, ending early or opening break apps needs an override code. Time on your phone doesn’t count toward it.`
            : 'Optional. Makes quitting early take deliberate effort.'
        }
      />

      <Card tone="accent">
        <Label>Once you start</Label>
        <Body>
          Leave OnTask open and put your phone out of reach. Just having it on your desk measurably lowers working memory. The screen stays on and OnTask
          chimes when it’s time for a break.
        </Body>
      </Card>

      <Button
        title="Start focusing"
        disabled={!task.trim()}
        onPress={() => store.startSession({ task: task.trim(), firstStep: firstStep.trim(), ifThen: ifThen.trim(), methodId, lockMin })}
      />
    </Screen>
  );
}

function SummaryCard({ record }: { record: S.SessionRecord }) {
  const answered = record.checkInsOnTask + record.checkInsOffTask;
  return (
    <Card>
      <Label>Last session</Label>
      <Body style={{ fontWeight: '600' }}>{record.task}</Body>
      <Body>
        {fmtDur(record.focusMs)} focused · {record.blocksDone} block{record.blocksDone === 1 ? '' : 's'} · {record.leaves.length} phone check
        {record.leaves.length === 1 ? '' : 's'}
        {answered ? ` · on task at ${record.checkInsOnTask} of ${answered} check-ins` : ''}
      </Body>
      {record.openThoughts.length ? (
        <View style={{ gap: 4 }}>
          <Body muted>Thoughts you parked:</Body>
          {record.openThoughts.map((t, i) => (
            <Body key={i}>• {t}</Body>
          ))}
        </View>
      ) : null}
      <Button kind="ghost" title="Dismiss" onPress={store.dismissSummary} />
    </Card>
  );
}

// --- during a session -------------------------------------------------------

function SessionView({ s }: { s: S.Session }) {
  const t = useTheme();
  const now = useNow(500);
  const { checkInOpenSince } = store.useData();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const remaining = S.remainingMs(s, now);
  const length = S.phaseLengthMs(s);
  const progress = remaining !== null && length ? 1 - remaining / length : 0;
  const lockLeft = S.lockRemainingMs(s, now);
  const blockMs = S.currentBlockMs(s, now);

  const heading =
    s.phase === 'focus' ? (s.pausedAt ? 'Paused' : `Focus · block ${s.blocksDone + 1}`) : s.phase === 'break' ? (s.breakIsLong ? 'Long break' : 'Break') : 'Break’s over';

  const end = () => {
    if (lockLeft > 0) router.push('/override?mode=end');
    else setConfirmEnd(true);
  };

  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: 4 }}>
        <Label>{heading}</Label>
        <Text style={{ fontSize: 20, fontWeight: '600', color: t.fg, textAlign: 'center' }}>{s.task}</Text>
      </View>

      <TimerRing progress={s.phase === 'ready' ? 1 : progress} color={s.phase === 'focus' ? t.accent : t.warn}>
        <Text style={{ fontSize: 56, fontWeight: '300', color: t.fg, fontVariant: ['tabular-nums'] }}>
          {s.phase === 'ready' ? '0:00' : remaining === null ? fmtClock(blockMs) : fmtClock(remaining)}
        </Text>
        <Text style={{ color: t.muted, fontSize: 14 }}>{remaining === null && s.phase === 'focus' ? 'focused so far' : s.phase === 'ready' ? 'ready when you are' : 'left'}</Text>
      </TimerRing>

      {s.pendingLeave ? <LeaveCard s={s} /> : null}
      {checkInOpenSince !== null ? <CheckInCard /> : null}

      {s.phase === 'focus' ? <FocusControls s={s} blockMs={blockMs} /> : null}
      {s.phase === 'break' ? <BreakView s={s} lockLeft={lockLeft} /> : null}
      {s.phase === 'ready' ? <ReadyView s={s} /> : null}

      {s.lockMin > 0 ? (
        <Body muted style={{ textAlign: 'center' }}>
          {lockLeft > 0 ? `Locked · ${fmtDur(lockLeft)} more focus unlocks ending and break apps` : 'Commitment met · everything is unlocked'}
        </Body>
      ) : null}
      <Body muted style={{ textAlign: 'center' }}>
        {fmtDur(S.totalFocusMs(s, now))} focused · {s.leaves.length} phone check{s.leaves.length === 1 ? '' : 's'}
      </Body>

      {confirmEnd ? (
        <Card>
          <Body>End this session?</Body>
          <Row>
            <Button
              flex
              title="End session"
              onPress={() => {
                setConfirmEnd(false);
                store.endSession(false);
              }}
            />
            <Button flex kind="secondary" title="Keep going" onPress={() => setConfirmEnd(false)} />
          </Row>
        </Card>
      ) : (
        <Button kind="ghost" title="End session" onPress={end} />
      )}
    </Screen>
  );
}

function FocusControls({ s, blockMs }: { s: S.Session; blockMs: number }) {
  const [parking, setParking] = useState(false);
  const [thought, setThought] = useState('');
  const save = () => {
    if (thought.trim()) store.parkThought(thought.trim());
    setThought('');
    setParking(false);
  };
  return (
    <View style={{ gap: 12 }}>
      {s.blocksDone === 0 && s.firstStep && blockMs < 5 * S.MIN ? (
        <Card tone="accent">
          <Label>Start with</Label>
          <Body>{s.firstStep}</Body>
        </Card>
      ) : null}
      {parking ? (
        <Card>
          <Field label="Park a thought" placeholder="What popped into your head?" value={thought} onChangeText={setThought} autoFocus onSubmitEditing={save} returnKeyType="done" />
          <Body muted style={{ fontSize: 13 }}>
            Writing it down lets your mind drop it. You’ll see it on your break.
          </Body>
          <Row>
            <Button flex title="Save" onPress={save} />
            <Button flex kind="secondary" title="Cancel" onPress={() => setParking(false)} />
          </Row>
        </Card>
      ) : null}
      <Row>
        <Button flex kind="secondary" title={s.pausedAt ? 'Resume' : 'Pause'} onPress={s.pausedAt ? store.resume : store.pause} />
        <Button flex kind="secondary" title={`Park a thought${s.thoughts.length ? ` (${s.thoughts.length})` : ''}`} onPress={() => setParking(true)} />
      </Row>
      {s.method.flow && !s.pausedAt ? <Button title="Take a break" onPress={store.takeFlowBreak} /> : null}
    </View>
  );
}

function BreakView({ s, lockLeft }: { s: S.Session; lockLeft: number }) {
  const [note, setNote] = useState(s.resumeNote);
  const locked = lockLeft > 0;
  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Field
          label="Where are you leaving off?"
          placeholder="e.g. next: part (b), use the lemma from lecture 6"
          value={note}
          onChangeText={setNote}
          onEndEditing={() => store.setResumeNote(note.trim())}
          onBlur={() => store.setResumeNote(note.trim())}
          hint="Writing your next step lets you actually switch off on the break. You’ll see it when the break ends."
        />
      </Card>

      <Card tone="accent">
        <Label>Move a little</Label>
        <Body>{MOVES[(s.blocksDone - 1 + MOVES.length) % MOVES.length]}</Body>
      </Card>

      <Card>
        <Label>On your break</Label>
        <Body muted>
          {locked
            ? `These unlock after ${fmtDur(lockLeft)} more focus. Try moving instead.`
            : 'Go ahead and scroll. OnTask will call you back when the break ends.'}
        </Body>
        <Row gap={8}>
          {BREAK_APPS.map((app) => (
            <Button key={app.name} kind="secondary" title={app.name} disabled={locked} onPress={() => openApp(app)} />
          ))}
        </Row>
        {locked ? <Button kind="ghost" title="Unlock with override code" onPress={() => router.push('/override?mode=unlock')} /> : null}
      </Card>

      <Thoughts s={s} />
      <Button kind="secondary" title="Skip the rest of the break" onPress={store.startNextBlock} />
    </View>
  );
}

function ReadyView({ s }: { s: S.Session }) {
  return (
    <View style={{ gap: 12 }}>
      {s.resumeNote ? (
        <Card tone="accent">
          <Label>Pick up where you left off</Label>
          <Body>{s.resumeNote}</Body>
        </Card>
      ) : null}
      <Thoughts s={s} />
      <Button title={`Start block ${s.blocksDone + 1}`} onPress={store.startNextBlock} />
    </View>
  );
}

function Thoughts({ s }: { s: S.Session }) {
  const t = useTheme();
  if (!s.thoughts.length) return null;
  return (
    <Card>
      <Label>Parked thoughts</Label>
      {s.thoughts.map((th, i) => (
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

function LeaveCard({ s }: { s: S.Session }) {
  const p = s.pendingLeave!;
  return (
    <Card tone="warn">
      <Label>You were away {fmtDur(p.ms)}</Label>
      <Body>Were you on your phone?</Body>
      {s.ifThen ? <Body muted>Your plan: if I get distracted, I will {s.ifThen}.</Body> : null}
      <Row>
        <Button flex kind="secondary" title="Yes" onPress={() => store.answerLeave(true)} />
        <Button flex kind="secondary" title="No, it was put away" onPress={() => store.answerLeave(false)} />
      </Row>
    </Card>
  );
}

function CheckInCard() {
  return (
    <Card tone="accent">
      <Label>Quick check-in</Label>
      <Body>Were you on task just now?</Body>
      <Row>
        <Button flex kind="secondary" title="Yes" onPress={() => store.answerCheckIn(true)} />
        <Button flex kind="secondary" title="Not really" onPress={() => store.answerCheckIn(false)} />
      </Row>
    </Card>
  );
}
