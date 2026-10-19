import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Fonts, Palette, Spacing } from '@/constants/theme';

export function usePalette() {
  const scheme = useColorScheme();
  return Palette[scheme === 'dark' ? 'dark' : 'light'];
}

type AuthScreenProps = {
  /** Plain lead-in, followed by an italic serif accent, e.g. "Welcome" + "back." */
  lead: string;
  accent: string;
  intro?: string;
  children: ReactNode;
};

/** Shared shell for the account screens: back link, editorial title, keyboard handling. */
export function AuthScreen({ lead, accent, intro, children }: AuthScreenProps) {
  const colors = usePalette();
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/welcome'));

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.canvas }]}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <Pressable accessibilityRole="button" onPress={goBack} hitSlop={12}>
              <Text style={[styles.backText, { color: colors.textMuted }]}>‹ Back</Text>
            </Pressable>
            <Text style={[styles.wordmark, { color: colors.text }]}>RUN</Text>
          </View>

          <Text style={[styles.title, { color: colors.text }]}>
            {lead} <Text style={styles.serifItalic}>{accent}</Text>
          </Text>
          {intro && <Text style={[styles.intro, { color: colors.textMuted }]}>{intro}</Text>}

          <View style={styles.body}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type TextFieldProps = Omit<TextInputProps, 'style' | 'secureTextEntry'> & {
  label: string;
  error?: string | null;
  /** Adds a Show/Hide control and hides the text by default. */
  isPassword?: boolean;
};

export function TextField({ label, error, isPassword = false, ...inputProps }: TextFieldProps) {
  const colors = usePalette();
  const [isHidden, setIsHidden] = useState(true);

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <View
        style={[
          styles.inputWrap,
          { backgroundColor: colors.card, borderColor: error ? colors.text : colors.border },
        ]}>
        <TextInput
          {...inputProps}
          secureTextEntry={isPassword && isHidden}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={label}
          style={[styles.input, { color: colors.text }]}
        />
        {isPassword && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isHidden ? `Show ${label.toLowerCase()}` : `Hide ${label.toLowerCase()}`}
            onPress={() => setIsHidden((hidden) => !hidden)}
            hitSlop={8}
            style={styles.toggle}>
            <Text style={[styles.toggleText, { color: colors.text }]}>
              {isHidden ? 'SHOW' : 'HIDE'}
            </Text>
          </Pressable>
        )}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.text }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
};

type PrimaryButtonProps = ButtonProps & {
  /** Overrides the default lime, e.g. Strava orange on Strava screens. */
  tint?: { background: string; text: string };
};

export function PrimaryButton({ label, onPress, loading = false, tint }: PrimaryButtonProps) {
  const palette = usePalette();
  const background = tint?.background ?? palette.accent;
  const textColor = tint?.text ?? palette.accentText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: loading }}
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: background },
        (pressed || loading) && styles.pressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[styles.primaryButtonText, { color: textColor }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress }: ButtonProps) {
  const colors = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        { borderColor: colors.text },
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.secondaryButtonText, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

/** Inline text link, e.g. "Already have an account? Log in". */
export function LinkRow({ prompt, action, onPress }: { prompt: string; action: string; onPress: () => void }) {
  const colors = usePalette();
  return (
    <View style={styles.linkRow}>
      <Text style={[styles.linkPrompt, { color: colors.textMuted }]}>{prompt} </Text>
      <Pressable accessibilityRole="link" onPress={onPress} hitSlop={8}>
        <Text style={[styles.linkAction, { color: colors.text }]}>{action}</Text>
      </Pressable>
    </View>
  );
}

type NoticeProps = {
  title?: string;
  children: ReactNode;
  /** `error` uses the dark card so it stands out; `info` is the quiet surface card. */
  tone?: 'info' | 'error';
};

export function Notice({ title, children, tone = 'info' }: NoticeProps) {
  const colors = usePalette();
  const isError = tone === 'error';
  return (
    <View
      accessibilityRole={isError ? 'alert' : undefined}
      style={[styles.notice, { backgroundColor: isError ? colors.hero : colors.surface }]}>
      {title && (
        <Text style={[styles.noticeTitle, { color: isError ? colors.accent : colors.text }]}>
          {title}
        </Text>
      )}
      <Text style={[styles.noticeText, { color: isError ? colors.heroText : colors.textMuted }]}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backText: {
    fontSize: 16,
    fontWeight: '500',
  },
  wordmark: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 4,
  },
  title: {
    fontSize: 44,
    fontWeight: '400',
    letterSpacing: -1.5,
    lineHeight: 50,
    marginTop: Spacing.five,
  },
  serifItalic: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
  },
  intro: {
    fontSize: 16,
    lineHeight: 23,
    marginTop: Spacing.two,
  },
  body: {
    marginTop: Spacing.four,
    gap: Spacing.three,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
  },
  input: {
    flex: 1,
    fontSize: 17,
    height: '100%',
  },
  toggle: {
    paddingLeft: Spacing.two,
  },
  toggleText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  error: {
    fontSize: 13,
    fontWeight: '600',
  },
  primaryButton: {
    height: 60,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.two,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  secondaryButton: {
    height: 56,
    borderRadius: 999,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  linkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: Spacing.two,
  },
  linkPrompt: {
    fontSize: 15,
  },
  linkAction: {
    fontSize: 15,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  notice: {
    borderRadius: 20,
    padding: Spacing.three,
    gap: 4,
  },
  noticeTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  noticeText: {
    fontSize: 14,
    lineHeight: 20,
  },
});
