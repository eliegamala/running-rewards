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
import { readJson, writeJson } from '@/lib/local-json';
import { getRewardCredit, REWARD_DISTANCE_KM, subscribe } from '@/lib/reward-credit';

const STORAGE_NAME = 'celebrated-rewards';

/**
 * Celebrates each active reward once, including one unlocked by a Strava run while the app
 * was closed. Remembers celebrated credit ids on this phone.
 */
export function RewardCelebration() {
  const scheme = useColorScheme();
  const colors = Palette[scheme === 'dark' ? 'dark' : 'light'];
  const credit = useSyncExternalStore(subscribe, getRewardCredit);
  const [celebrated, setCelebrated] = useState(() => readJson<string[]>(STORAGE_NAME, []));
  const visible =
    credit.status === 'unlocked' && credit.id !== null && !celebrated.includes(credit.id);
  const dismiss = () => {
    if (!credit.id) return;
    const next = [credit.id, ...celebrated].slice(0, 20);
    setCelebrated(next);
    writeJson(STORAGE_NAME, next);
  };

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
