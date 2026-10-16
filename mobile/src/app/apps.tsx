// Choose your OnTask Apps: the apps you allow yourself during a session.

import { router } from 'expo-router';
import { Body, Button, Card, Screen, Toggle } from '@/components/ui';
import { ONTASK_APPS } from '@/lib/ontaskApps';
import { updateSettings, useData } from '@/lib/store';

export default function AppsScreen() {
  const { settings } = useData();
  const chosen = new Set(settings.ontaskApps);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    updateSettings({ ontaskApps: ONTASK_APPS.map((a) => a.id).filter((x) => next.has(x)) });
  };
  return (
    <Screen>
      <Body muted>
        Pick the apps you use for your work. Open them from OnTask’s timer screen and it won’t count as leaving; if you wander off, the reminder brings you
        back to the last one you were in.
      </Body>
      <Card>
        {ONTASK_APPS.map((app) => (
          <Toggle key={app.id} label={app.name} value={chosen.has(app.id)} onValueChange={(on) => toggle(app.id, on)} />
        ))}
      </Card>
      <Body muted style={{ fontSize: 13 }}>
        For OnTask to notice when you switch to an app that isn’t on this list, it needs Apple’s Screen Time access, which comes with the full app build.
      </Body>
      <Button title="Done" onPress={() => router.back()} />
    </Screen>
  );
}
