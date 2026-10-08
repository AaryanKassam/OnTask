// A ring that empties as the phase runs out, so remaining time is something
// you can see at a glance rather than a number you have to read.

import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from './ui';

export function TimerRing({ progress, color, size = 260, children }: { progress: number; color?: string; size?: number; children: ReactNode }) {
  const t = useTheme();
  const stroke = 14;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const remaining = Math.min(1, Math.max(0, 1 - progress));
  return (
    <View style={{ width: size, height: size, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.line} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color ?? t.accent}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - remaining)}
        />
      </Svg>
      {children}
    </View>
  );
}
