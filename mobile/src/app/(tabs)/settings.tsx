import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { Body, Button, Card, Choice, Label, Row, Screen, Title, Toggle, useTheme } from '@/components/ui';
import { METHODS } from '@/lib/methods';
import { RESEARCH } from '@/lib/research';
import { clearHistory, updateSettings, useData } from '@/lib/store';

export default function SettingsScreen() {
  const t = useTheme();
  const { settings: st, history } = useData();
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <Screen>
      <Title>Settings</Title>

      <Card>
        <Choice label="Default study method" options={METHODS.map((m) => ({ label: m.name, value: m.id }))} value={st.methodId} onChange={(methodId) => updateSettings({ methodId })} />
        <Choice label="Custom focus length" options={[15, 20, 30, 40, 45, 60].map((m) => ({ label: `${m} min`, value: m }))} value={st.customFocusMin} onChange={(customFocusMin) => updateSettings({ customFocusMin })} />
        <Choice label="Custom break length" options={[3, 5, 10, 15].map((m) => ({ label: `${m} min`, value: m }))} value={st.customBreakMin} onChange={(customBreakMin) => updateSettings({ customBreakMin })} />
      </Card>

      <Card>
        <Label>When you leave OnTask during focus</Label>
        <Toggle
          label="Remind me to come back"
          hint="Sends a notification with sound if you’re still away after the grace period, then again at 3 and 10 minutes."
          value={st.leaveReminders}
          onValueChange={(leaveReminders) => updateSettings({ leaveReminders })}
        />
        <Choice
          label="Grace period"
          options={[10, 15, 30, 60].map((s) => ({ label: `${s} s`, value: s }))}
          value={st.leaveGraceSec}
          onChange={(leaveGraceSec) => updateSettings({ leaveGraceSec })}
          hint="Shorter trips away are treated as noise, like glancing at a message, and aren’t counted."
        />
      </Card>

      <Card>
        <Choice
          label="Random check-ins"
          options={[0, 10, 20, 30].map((m) => ({ label: m ? `About every ${m} min` : 'Off', value: m }))}
          value={st.checkInEveryMin}
          onChange={(checkInEveryMin) => updateSettings({ checkInEveryMin })}
          hint="A chime asks whether you were on task at unpredictable moments during focus, while OnTask is open."
        />
      </Card>

      <Card>
        <Label>Alerts</Label>
        <Toggle label="Sounds" value={st.sound} onValueChange={(sound) => updateSettings({ sound })} />
        <Toggle label="Vibration" value={st.vibration} onValueChange={(vibration) => updateSettings({ vibration })} />
        <Toggle label="Keep the screen on during focus" value={st.keepAwake} onValueChange={(keepAwake) => updateSettings({ keepAwake })} />
      </Card>

      <Card>
        <Choice
          label="Override code wait"
          options={[10, 20, 45, 90].map((s) => ({ label: `${s} s`, value: s }))}
          value={st.overrideWaitSec}
          onChange={(overrideWaitSec) => updateSettings({ overrideWaitSec })}
          hint="How long you wait before the code appears when breaking a commitment lock. Urges often pass in that time."
        />
        <Body muted style={{ fontSize: 13 }}>
          The lock is a soft lock: OnTask can’t block other apps yet. It holds back ending the session and its own break shortcuts, and reminds you when you
          leave. Blocking apps at the system level needs a native build, which is planned.
        </Body>
      </Card>

      <Label>Why it works</Label>
      {RESEARCH.map((r) => (
        <Card key={r.title}>
          <Body style={{ fontWeight: '600' }}>{r.title}</Body>
          <Body>{r.what}</Body>
          <Body muted>{r.how}</Body>
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(r.source.url)} style={{ minHeight: 32, justifyContent: 'center' }}>
            <Text style={{ color: t.accentText, fontSize: 14, textDecorationLine: 'underline' }}>{r.source.label}</Text>
          </Pressable>
        </Card>
      ))}

      {history.length ? (
        confirmClear ? (
          <Card>
            <Body>Delete all {history.length} saved sessions? This can’t be undone.</Body>
            <Row>
              <Button
                flex
                title="Delete"
                onPress={() => {
                  clearHistory();
                  setConfirmClear(false);
                }}
              />
              <Button flex kind="secondary" title="Cancel" onPress={() => setConfirmClear(false)} />
            </Row>
          </Card>
        ) : (
          <Button kind="ghost" title="Clear session history" onPress={() => setConfirmClear(true)} />
        )
      ) : null}
    </Screen>
  );
}
