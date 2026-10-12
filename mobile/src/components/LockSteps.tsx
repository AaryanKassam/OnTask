// How to lock the phone to OnTask with what's built into the phone: Guided
// Access on iPhone, app pinning on Android. Both need a code to get out.

import { Platform, View } from 'react-native';
import { Body } from './ui';

const IOS = [
  'Open Settings → Accessibility → Guided Access and turn it on.',
  'Tap Passcode Settings → Set Guided Access Passcode. Pick one you’d have to stop and think to type. That’s your override code.',
  'Back in OnTask, triple-click the side button (or the Home button) and tap Start.',
  'Your phone now stays in OnTask: no other apps, no swiping away.',
  'At break time, triple-click, enter the passcode and tap End to use other apps.',
];

const ANDROID = [
  'Open Settings → Security (or Security & privacy → More security settings) → App pinning, and turn it on.',
  'Turn on “Ask for PIN before unpinning”. Your screen-lock PIN becomes the override code.',
  'Open OnTask, open Recent apps (swipe up and hold), tap the OnTask icon at the top of its card, then Pin.',
  'Your phone now stays in OnTask until you unpin it.',
  'At break time, swipe up and hold (or press Back and Overview together) and enter your PIN to unpin.',
];

export function LockSteps() {
  const steps = Platform.OS === 'android' ? ANDROID : IOS;
  return (
    <View style={{ gap: 6 }}>
      {steps.map((step, i) => (
        <Body key={i}>
          {i + 1}. {step}
        </Body>
      ))}
    </View>
  );
}
