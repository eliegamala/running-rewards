import { router } from 'expo-router';
import { useState } from 'react';

import {
  AuthScreen,
  LinkRow,
  Notice,
  PrimaryButton,
  SecondaryButton,
  TextField,
} from '@/components/auth-ui';
import { signUp } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase';
import {
  MIN_PASSWORD_LENGTH,
  validateEmail,
  validateNewPassword,
  validatePasswordConfirmation,
} from '@/lib/validation';

export default function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  // Field errors appear after the first submit, then update as the runner types.
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);

  const errors = {
    email: validateEmail(email),
    password: validateNewPassword(password),
    confirmation: validatePasswordConfirmation(password, confirmation),
  };

  const submit = async () => {
    setShowErrors(true);
    setServerError(null);
    if (errors.email || errors.password || errors.confirmation) return;

    setSubmitting(true);
    const result = await signUp(email.trim(), password);
    setSubmitting(false);

    if (!result.ok) {
      setServerError(result.message);
    } else if ('needsConfirmation' in result && result.needsConfirmation) {
      setConfirmationSentTo(email.trim());
    }
    // Otherwise Supabase returned a session and the app moves on automatically.
  };

  if (confirmationSentTo) {
    return (
      <AuthScreen
        lead="Check your"
        accent="inbox."
        intro={`We've sent a confirmation link to ${confirmationSentTo}. Open it on this phone, then log in to continue.`}>
        <PrimaryButton label="GO TO LOG IN" onPress={() => router.replace('/log-in')} />
        <SecondaryButton label="USE A DIFFERENT EMAIL" onPress={() => setConfirmationSentTo(null)} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      lead="Create your"
      accent="account."
      intro="Save your rewards and pick up where you left off on any run.">
      {!isSupabaseConfigured && (
        <Notice title="NOT AVAILABLE YET">
          Accounts aren&apos;t switched on yet. You can fill in the form, but nothing will be
          created until Supabase is configured.
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
        placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
        isPassword
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="next"
        error={showErrors ? errors.password : null}
      />
      <TextField
        label="Confirm password"
        value={confirmation}
        onChangeText={setConfirmation}
        placeholder="Re-enter your password"
        isPassword
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="done"
        onSubmitEditing={submit}
        error={showErrors ? errors.confirmation : null}
      />

      {serverError && (
        <Notice title="COULDN'T CREATE ACCOUNT" tone="error">
          {serverError}
        </Notice>
      )}

      <PrimaryButton label="CREATE ACCOUNT" onPress={submit} loading={submitting} />
      <LinkRow
        prompt="Already have an account?"
        action="Log in"
        onPress={() => router.replace('/log-in')}
      />
    </AuthScreen>
  );
}
