import { router } from 'expo-router';
import { useState, useSyncExternalStore } from 'react';
import { Alert } from 'react-native';

import {
  AuthScreen,
  Notice,
  PrimaryButton,
  SecondaryButton,
  TextField,
  usePalette,
} from '@/components/auth-ui';
import { formatClockTime } from '@/hooks/use-reward-credit';
import { DELETE_CONFIRMATION, deleteAccount, isDeleteConfirmed } from '@/lib/account';
import { getAuthState, subscribe as subscribeToAuth } from '@/lib/auth';
import { getRewardCredit, subscribe as subscribeToReward } from '@/lib/reward-credit';

const WHAT_IS_DELETED = [
  '• Your login and email address',
  '• All your rewards, including any you haven’t used yet',
  '• Your reward history',
  '• Your Strava connection and synced runs (we also withdraw access at Strava)',
  '• Reward alerts for this account',
].join('\n');

/**
 * Reached from Profile → Delete account. Nothing is deleted until the runner types DELETE
 * and presses the button; the server confirms before the phone signs out.
 */
export default function DeleteAccountScreen() {
  const colors = usePalette();
  const auth = useSyncExternalStore(subscribeToAuth, getAuthState);
  const credit = useSyncExternalStore(subscribeToReward, getRewardCredit);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const confirmed = isDeleteConfirmed(typed);
  const hasUnusedReward = credit.status === 'unlocked' && credit.expiresAt !== null;

  const keep = () => (router.canGoBack() ? router.back() : router.replace('/profile'));

  const remove = async () => {
    if (!confirmed || deleting) return;
    setDeleting(true);
    setMessage(null);
    const result = await deleteAccount(typed);
    if (!result.ok) {
      setDeleting(false);
      setMessage(result.message);
      return;
    }
    // Signed out by now; the app is back on Welcome.
    Alert.alert(
      'Account deleted',
      result.stravaRevoked === false
        ? "Your account and rewards are gone. We couldn't reach Strava, so you may want to remove this app under Strava → Settings → My Apps."
        : 'Your account and rewards are gone. Thanks for running with us.',
    );
  };

  return (
    <AuthScreen
      lead="Delete"
      accent="account."
      intro={`This permanently deletes ${auth.email ?? 'your account'}. It can’t be undone.`}>
      <Notice title="WHAT GETS DELETED">{WHAT_IS_DELETED}</Notice>
      {hasUnusedReward && (
        <Notice title="YOU HAVE AN UNUSED REWARD" tone="error">
          {`It will be lost. Use it before ${formatClockTime(credit.expiresAt!)} if you can.`}
        </Notice>
      )}
      <Notice>Your activities stay in your own Strava account.</Notice>

      <TextField
        label={`Type ${DELETE_CONFIRMATION} to confirm`}
        value={typed}
        onChangeText={setTyped}
        placeholder={DELETE_CONFIRMATION}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        returnKeyType="done"
        editable={!deleting}
        onSubmitEditing={() => void remove()}
      />
      {message && (
        <Notice title="NOT DELETED" tone="error">
          {message}
        </Notice>
      )}
      <PrimaryButton
        label="DELETE MY ACCOUNT"
        onPress={() => void remove()}
        loading={deleting}
        disabled={!confirmed}
        tint={{ background: colors.hero, text: colors.heroText }}
      />
      <SecondaryButton label="KEEP MY ACCOUNT" onPress={keep} />
    </AuthScreen>
  );
}
