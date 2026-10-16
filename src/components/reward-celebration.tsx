import { router } from 'expo-router';
import { useState, useSyncExternalStore } from 'react';
import { Text, useColorScheme } from 'react-native';

import {
  CelebrationModal,
  ModalBadge,
  ModalButton,
  modalText,
} from '@/components/celebration-modal';
import { Palette } from '@/constants/theme';
import { getRewardCredit, REWARD_DISTANCE_KM, subscribe } from '@/lib/reward-credit';

// Rewards restored from storage were already celebrated when they unlocked.
const APP_STARTED_AT = Date.now();

/** One-time celebration shown when a 5 km reward credit unlocks during this session. */
export function RewardCelebration() {
  const scheme = useColorScheme();
  const colors = Palette[scheme === 'dark' ? 'dark' : 'light'];
  const credit = useSyncExternalStore(subscribe, getRewardCredit);
  // Tracks which credit was dismissed, so a later credit can still be celebrated.
  const [dismissedId, setDismissedId] = useState<number | null>(null);
  const visible =
    credit.status === 'unlocked' &&
    credit.unlockedAt !== null &&
    credit.unlockedAt >= APP_STARTED_AT &&
    credit.unlockedAt !== dismissedId;
  const dismiss = () => setDismissedId(credit.unlockedAt);

  const chooseReward = () => {
    dismiss();
    router.navigate('/rewards');
  };

  return (
    <CelebrationModal visible={visible} celebrate onRequestClose={dismiss}>
      <ModalBadge>☕</ModalBadge>
      <Text style={[modalText.eyebrow, { color: colors.accent }]}>
        {REWARD_DISTANCE_KM} KM DONE
      </Text>
      <Text style={[modalText.title, { color: colors.heroText }]}>
        Reward{'\n'}
        <Text style={modalText.serifItalic}>unlocked.</Text>
      </Text>
      <Text style={[modalText.copy, { color: colors.heroMuted }]}>
        One reward, any participating spot. It&apos;s yours for the next hour.
      </Text>
      <ModalButton label="CHOOSE MY REWARD" onPress={chooseReward} />
      <ModalButton label="Not now" variant="secondary" onPress={dismiss} />
    </CelebrationModal>
  );
}
