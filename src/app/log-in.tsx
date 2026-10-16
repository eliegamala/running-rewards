import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import {
  AuthScreen,
  LinkRow,
  Notice,
  PrimaryButton,
  TextField,
  usePalette,
} from '@/components/auth-ui';
import { logIn } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase';
import { validateEmail, validateExistingPassword } from '@/lib/validation';

export default function LogInScreen() {
  const colors = usePalette();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const errors = {
    email: validateEmail(email),
    password: validateExistingPassword(password),
  };

  const submit = async () => {
    setShowErrors(true);
    setServerError(null);
    if (errors.email || errors.password) return;

    setSubmitting(true);
    const result = await logIn(email.trim(), password);
    setSubmitting(false);
    // On success the confirmed session moves the app on; nothing to do here.
    if (!result.ok) setServerError(result.message);
  };

  return (
    <AuthScreen lead="Welcome" accent="back." intro="Log in to see your rewards.">
      {!isSupabaseConfigured && (
        <Notice title="NOT AVAILABLE YET">
          Accounts aren&apos;t switched on yet, so logging in won&apos;t work until Supabase is
          configured.
        </Notice>
      )}

      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="name@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        error={showErrors ? errors.email : null}
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Your password"
        isPassword
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="done"
        onSubmitEditing={submit}
        error={showErrors ? errors.password : null}
      />

      <Pressable
        accessibilityRole="link"
        onPress={() => router.push('/forgot-password')}
        hitSlop={8}
        style={styles.forgot}>
        <Text style={[styles.forgotText, { color: colors.text }]}>Forgot password?</Text>
      </Pressable>

      {serverError && (
        <Notice title="COULDN'T LOG IN" tone="error">
          {serverError}
        </Notice>
      )}

      <PrimaryButton label="LOG IN" onPress={submit} loading={submitting} />
      <LinkRow
        prompt="New here?"
        action="Create an account"
        onPress={() => router.replace('/sign-up')}
      />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  forgot: {
    alignSelf: 'flex-end',
  },
  forgotText: {
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
