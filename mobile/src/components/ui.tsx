import type { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useColorScheme,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const light = {
  bg: '#f6f7f8',
  card: '#ffffff',
  fg: '#17191c',
  muted: '#5b626b',
  line: '#e2e5e9',
  accent: '#1f5c42',
  accentText: '#1f5c42',
  accentSoft: '#e4efe9',
  onAccent: '#ffffff',
  warn: '#b4410c',
  warnSoft: '#fbeee6',
  field: '#ffffff',
};
const dark: typeof light = {
  bg: '#111315',
  card: '#1b1e22',
  fg: '#eceef0',
  muted: '#a2a9b1',
  line: '#2d3238',
  accent: '#2f8a62',
  accentText: '#5fcf98',
  accentSoft: '#1b3328',
  onAccent: '#ffffff',
  warn: '#f0803c',
  warnSoft: '#36231a',
  field: '#15181b',
};
export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export function Screen({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: 40, gap: 14 }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Title({ children, sub }: { children: ReactNode; sub?: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ fontSize: 28, fontWeight: '700', color: t.fg }}>{children}</Text>
      {sub ? <Text style={{ fontSize: 15, color: t.muted }}>{sub}</Text> : null}
    </View>
  );
}

export function Label({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ fontSize: 12, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', color: t.muted }}>{children}</Text>;
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  const t = useTheme();
  return <Text style={[{ fontSize: 15, lineHeight: 21, color: muted ? t.muted : t.fg }, style]}>{children}</Text>;
}

export function Card({ children, tone = 'plain', style }: { children: ReactNode; tone?: 'plain' | 'accent' | 'warn'; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const bg = tone === 'accent' ? t.accentSoft : tone === 'warn' ? t.warnSoft : t.card;
  return (
    <View style={[{ backgroundColor: bg, borderRadius: 14, padding: 16, gap: 10, borderWidth: tone === 'plain' ? StyleSheet.hairlineWidth : 0, borderColor: t.line }, style]}>
      {children}
    </View>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'ghost';

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  flex,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  flex?: boolean;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : kind === 'secondary' ? t.card : 'transparent';
  const fg = kind === 'primary' ? t.onAccent : kind === 'secondary' ? t.fg : t.accentText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: flex ? 1 : undefined,
        minHeight: 48,
        paddingHorizontal: 16,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
        borderWidth: kind === 'secondary' ? 1 : 0,
        borderColor: t.line,
        opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ color: fg, fontSize: 16, fontWeight: '600', textAlign: 'center' }}>{title}</Text>
    </Pressable>
  );
}

export function Row({ children, gap = 10 }: { children: ReactNode; gap?: number }) {
  return <View style={{ flexDirection: 'row', gap, flexWrap: 'wrap' }}>{children}</View>;
}

export function Chip({ label, sub, selected, onPress }: { label: string; sub?: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minHeight: 44,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 22,
        justifyContent: 'center',
        backgroundColor: selected ? t.accentSoft : t.card,
        borderWidth: 1,
        borderColor: selected ? t.accent : t.line,
      }}
    >
      <Text style={{ color: selected ? t.accentText : t.fg, fontWeight: '600', fontSize: 15 }}>{label}</Text>
      {sub ? <Text style={{ color: t.muted, fontSize: 12 }}>{sub}</Text> : null}
    </Pressable>
  );
}

export function Choice<T extends string | number>({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  options: { label: string; value: T; sub?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Label>{label}</Label>
      <Row gap={8}>
        {options.map((o) => (
          <Chip key={String(o.value)} label={o.label} sub={o.sub} selected={o.value === value} onPress={() => onChange(o.value)} />
        ))}
      </Row>
      {hint ? <Body muted>{hint}</Body> : null}
    </View>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <TextInput
        placeholderTextColor={t.muted}
        accessibilityLabel={label}
        {...props}
        style={{
          minHeight: 48,
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.line,
          backgroundColor: t.field,
          color: t.fg,
          fontSize: 16,
        }}
      />
      {hint ? <Body muted style={{ fontSize: 13 }}>{hint}</Body> : null}
    </View>
  );
}

export function Toggle({ label, hint, value, onValueChange }: { label: string; hint?: string; value: boolean; onValueChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}>
      <View style={{ flex: 1 }}>
        <Body>{label}</Body>
        {hint ? <Body muted style={{ fontSize: 13 }}>{hint}</Body> : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: t.accent, false: t.line }} accessibilityLabel={label} />
    </View>
  );
}

export function Stat({ value, label }: { value: string; label: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 140, backgroundColor: t.card, borderRadius: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
      <Text style={{ fontSize: 22, fontWeight: '700', color: t.fg, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={{ fontSize: 13, color: t.muted }}>{label}</Text>
    </View>
  );
}
