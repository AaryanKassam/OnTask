import { Text, View } from 'react-native';
import { Body, Button, Card, Label, Row, Screen, Stat, Title, useTheme } from '@/components/ui';
import { fmtDur } from '@/lib/format';
import { recommend, summarize, weekBars } from '@/lib/insights';
import { METHODS } from '@/lib/methods';
import { updateSettings, useData } from '@/lib/store';
import { useNow } from '@/lib/useNow';

export default function InsightsScreen() {
  const t = useTheme();
  const now = useNow(60_000);
  const { history, settings } = useData();
  const sum = summarize(history, now);
  const bars = weekBars(history, now);
  const recs = recommend(history, settings.methodId, now);
  const max = Math.max(30, ...bars.map((b) => b.minutes));

  return (
    <Screen>
      <Title sub="Your last 7 days">Insights</Title>

      <Row>
        <Stat value={fmtDur(sum.focusMs)} label="Focused" />
        <Stat value={String(sum.sessions)} label="Sessions" />
        <Stat value={sum.checksPerHour === null ? '–' : sum.checksPerHour.toFixed(1)} label="Phone checks per focus hour" />
        <Stat value={sum.minutesToFirstCheck === null ? '–' : `${sum.minutesToFirstCheck} min`} label="Typical time before a phone check" />
        {sum.onTaskRate !== null ? <Stat value={`${Math.round(sum.onTaskRate * 100)}%`} label="On task at check-ins" /> : null}
      </Row>

      <Card>
        <Label>Minutes focused</Label>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 140, gap: 8 }} accessibilityRole="image" accessibilityLabel={bars.map((b) => `${b.label} ${b.minutes} minutes`).join(', ')}>
          {bars.map((b) => (
            <View key={b.label + b.today} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 11, color: t.muted, fontVariant: ['tabular-nums'] }}>{b.minutes || ''}</Text>
              <View style={{ width: '100%', height: Math.max(2, (b.minutes / max) * 100), borderRadius: 4, backgroundColor: t.accent, opacity: b.today ? 1 : 0.45 }} />
              <Text style={{ fontSize: 12, color: b.today ? t.fg : t.muted, fontWeight: b.today ? '600' : '400' }}>{b.label}</Text>
            </View>
          ))}
        </View>
      </Card>

      <Label>Suggestions</Label>
      {recs.map((r) => {
        const method = METHODS.find((m) => m.id === r.methodId);
        return (
          <Card key={r.id} tone={r.methodId ? 'accent' : 'plain'}>
            <Body style={{ fontWeight: '600' }}>{r.title}</Body>
            <Body muted>{r.body}</Body>
            {method && settings.methodId !== method.id ? (
              <Button kind="secondary" title={`Use ${method.name}`} onPress={() => updateSettings({ methodId: method.id })} />
            ) : null}
          </Card>
        );
      })}

      {history.length ? (
        <>
          <Label>Recent sessions</Label>
          <Card>
            {history.slice(0, 10).map((r) => (
              <View key={r.id} style={{ gap: 2, paddingVertical: 6 }}>
                <Body style={{ fontWeight: '600' }}>{r.task}</Body>
                <Body muted style={{ fontSize: 13 }}>
                  {new Date(r.startedAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · {r.methodName} · {fmtDur(r.focusMs)} ·{' '}
                  {r.leaves.length} phone check{r.leaves.length === 1 ? '' : 's'}
                  {r.endedEarly ? ' · ended early' : ''}
                </Body>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
