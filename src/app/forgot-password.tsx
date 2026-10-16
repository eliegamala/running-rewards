import { router } from 'expo-router';

import { AuthScreen, Notice, SecondaryButton } from '@/components/auth-ui';

/**
 * Placeholder. Supabase can send reset emails, but the link has to open the app to set a
 * new password, which needs deep-link redirect URLs configured first. Until then this
 * screen says so instead of sending emails whose links lead nowhere.
 */
export default function ForgotPasswordScreen() {
  return (
    <AuthScreen
      lead="Forgot your"
      accent="password?"
      intro="Password reset is on its way.">
      <Notice title="COMING SOON">
        Resetting your password from the app isn&apos;t available yet. It will be switched on
        once email links can open the app securely.
      </Notice>
      <SecondaryButton
        label="BACK TO LOG IN"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/log-in'))}
      />
    </AuthScreen>
  );
}
