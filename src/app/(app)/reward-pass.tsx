import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  CelebrationModal,
  ModalBadge,
  ModalButton,
  modalText,
} from '@/components/celebration-modal';
import { StoreLocationDetails } from '@/components/store-location';
import { Fonts, Palette, Spacing } from '@/constants/theme';
import { formatClockTime, formatCountdown, useRewardCredit } from '@/hooks/use-reward-credit';
import { redeemReward, REWARD_DURATION_MS } from '@/lib/reward-credit';
import { getCategory, getPrimaryLocation, getStore, unlistedStore } from '@/lib/stores';

type RedeemStep = 'confirm' | 'done' | 'unavailable';

/**
 * Live pass for the store the runner chose. Everything is read from the single
 * reward credit, so the countdown and state follow its real `expiresAt`.
 */
export default function RewardPassScreen() {
  const scheme = useColorScheme();
  const colors = Palette[scheme === 'dark' ? 'dark' : 'light'];
  const { credit, status, remainingMs } = useRewardCredit();
  const [redeemStep, setRedeemStep] = useState<RedeemStep | null>(null);
  const [redeemedHere, setRedeemedHere] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const redeemingRef = useRef(false);

  const storeId = credit.redeemedStoreId ?? credit.selectedStoreId;
  const store = storeId ? (getStore(storeId) ?? unlistedStore(storeId)) : undefined;
  const isActive = status === 'unlocked' && store !== undefined;

  // Gentle pulse on the status dot so the pass reads as live, not a screenshot.
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!isActive) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isActive, pulse]);

  const backToRewards = () => router.navigate('/rewards');

  // The server redeems (checking expiry, store and single use); only its answer counts.
  const confirmRedeem = async () => {
    if (!store || redeemingRef.current) return;
    redeemingRef.current = true;
    setRedeeming(true);
    setNetworkError(false);
    const result = await redeemReward(store.id);
    redeemingRef.current = false;
    setRedeeming(false);
    if (result.ok) {
      setRedeemedHere(true);
      setRedeemStep('done');
    } else if (result.reason === 'network') {
      setNetworkError(true); // stay on the confirm step so they can retry
    } else {
      setRedeemStep('unavailable');
    }
  };

  if (!store) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.canvas }]}
        edges={['top', 'left', 'right']}>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            No active <Text style={styles.serifItalic}>pass.</Text>
          </Text>
          <Text style={[styles.supportCopy, { color: colors.textMuted }]}>
            Unlock a reward and choose a spot to get your live pass.
          </Text>
          <SecondaryButton label="BACK TO REWARDS" onPress={backToRewards} colors={colors} />
        </View>
      </SafeAreaView>
    );
  }

  const category = getCategory(store.category);
  const progress = Math.min(remainingMs / REWARD_DURATION_MS, 1);
  const statusLabel = isActive ? 'REWARD ACTIVE' : status === 'redeemed' ? 'REWARD USED' : 'REWARD EXPIRED';

  let supportCopy = 'Show this screen to staff when you arrive.';
  if (status === 'redeemed') {
    supportCopy = redeemedHere ? "You've used this reward." : "You've already used this reward.";
  } else if (status === 'expired') {
    supportCopy = 'This reward is no longer available.';
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.canvas }]}
      edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <Pressable accessibilityRole="button" onPress={backToRewards} hitSlop={12}>
            <Text style={[styles.backText, { color: colors.textMuted }]}>‹ Rewards</Text>
          </Pressable>
          <Text style={[styles.topLabel, { color: colors.textMuted }]}>REWARD PASS</Text>
        </View>

        <View style={[styles.pass, { backgroundColor: colors.hero }]}>
          <View style={styles.passTop}>
            <View style={styles.chipRow}>
              <View
                style={[
                  styles.statusChip,
                  { backgroundColor: isActive ? colors.accent : 'rgba(246, 242, 200, 0.14)' },
                ]}>
                {isActive && (
                  <Animated.View
                    style={[styles.liveDot, { backgroundColor: colors.accentText, opacity: pulse }]}
                  />
                )}
                <Text
                  style={[
                    styles.statusChipText,
                    { color: isActive ? colors.accentText : colors.heroText },
                  ]}>
                  {statusLabel}
                </Text>
              </View>
              <Text style={[styles.categoryText, { color: colors.heroMuted }]}>
                {category.emoji} {category.label}
              </Text>
            </View>

            <Text
              style={[styles.storeName, { color: colors.heroText }]}
              numberOfLines={1}
              adjustsFontSizeToFit>
              {store.name.toUpperCase()}
            </Text>
            <Text style={[styles.reward, styles.serifItalic, { color: colors.heroText }]}>
              {store.reward}
            </Text>
            <StoreLocationDetails
              location={getPrimaryLocation(store)}
              variant="pass"
              textColor={colors.heroText}
              mutedColor={colors.heroMuted}
              borderColor="rgba(246, 242, 200, 0.3)"
            />
          </View>

          {/* Ticket perforation */}
          <View style={styles.perforation}>
            <View style={[styles.notch, styles.notchLeft, { backgroundColor: colors.canvas }]} />
            <View style={[styles.dashes, { borderColor: 'rgba(246, 242, 200, 0.25)' }]} />
            <View style={[styles.notch, styles.notchRight, { backgroundColor: colors.canvas }]} />
          </View>

          <View style={styles.passBottom}>
            {isActive && (
              <>
                <Text style={[styles.figureLabel, { color: colors.heroMuted }]}>EXPIRES IN</Text>
                <Text style={[styles.countdown, { color: colors.accent }]}>
                  {formatCountdown(remainingMs)}
                </Text>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { backgroundColor: colors.accent, width: `${progress * 100}%` },
                    ]}
                  />
                </View>
              </>
            )}

            {status === 'redeemed' && (
              <>
                <Text style={[styles.redeemed, { color: colors.accent }]}>✓ REDEEMED</Text>
                {credit.redeemedAt !== null && (
                  <Text style={[styles.figureLabel, { color: colors.heroMuted }]}>
                    USED AT {formatClockTime(credit.redeemedAt)}
                  </Text>
                )}
              </>
            )}

            {status === 'expired' && (
              <>
                <Text style={[styles.figureLabel, { color: colors.heroMuted }]}>EXPIRED</Text>
                <Text style={[styles.countdown, { color: colors.heroMuted }]}>00:00</Text>
              </>
            )}
          </View>
        </View>

        <Text style={[styles.supportCopy, { color: colors.textMuted }]}>{supportCopy}</Text>

        {isActive && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setRedeemStep('confirm')}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: colors.accent },
              pressed && styles.pressed,
            ]}>
            <Text style={[styles.primaryButtonText, { color: colors.accentText }]}>
              REDEEM REWARD
            </Text>
          </Pressable>
        )}
        <SecondaryButton label="BACK TO REWARDS" onPress={backToRewards} colors={colors} />
      </ScrollView>

      {redeemStep !== null && (
        <CelebrationModal
          visible
          celebrate={redeemStep === 'done'}
          onRequestClose={() => setRedeemStep(null)}>
          {redeemStep === 'confirm' && (
            <>
              <ModalBadge>{category.emoji}</ModalBadge>
              <Text style={[modalText.eyebrow, { color: colors.accent }]}>AT THE COUNTER?</Text>
              <Text style={[modalText.title, { color: colors.heroText }]}>
                Redeem at{'\n'}
                <Text style={modalText.serifItalic}>{store.name}.</Text>
              </Text>
              <Text style={[modalText.copy, { color: colors.heroMuted }]}>
                Only redeem in front of staff. This uses your reward and can&apos;t be undone.
              </Text>
              {networkError && (
                <Text style={[modalText.copy, { color: colors.accent }]}>
                  Couldn&apos;t reach the server. Check your connection and try again.
                </Text>
              )}
              <ModalButton label={redeeming ? 'REDEEMING…' : 'REDEEM NOW'} onPress={confirmRedeem} />
              <ModalButton label="Cancel" variant="secondary" onPress={() => setRedeemStep(null)} />
            </>
          )}

          {redeemStep === 'done' && (
            <>
              <ModalBadge>✓</ModalBadge>
              <Text style={[modalText.eyebrow, { color: colors.accent }]}>REWARD USED</Text>
              <Text style={[modalText.title, { color: colors.heroText }]}>
                Enjoy it at{'\n'}
                <Text style={modalText.serifItalic}>{store.name}.</Text>
              </Text>
              <Text style={[modalText.copy, { color: colors.heroMuted }]}>{store.reward}</Text>
              <ModalButton label="DONE" onPress={() => setRedeemStep(null)} />
            </>
          )}

          {redeemStep === 'unavailable' && (
            <>
              <ModalBadge>⌛</ModalBadge>
              <Text style={[modalText.eyebrow, { color: colors.accent }]}>REWARD UNAVAILABLE</Text>
              <Text style={[modalText.title, { color: colors.heroText }]}>
                This one <Text style={modalText.serifItalic}>got away.</Text>
              </Text>
              <Text style={[modalText.copy, { color: colors.heroMuted }]}>
                This reward has expired or has already been used.
              </Text>
              <ModalButton label="OK" onPress={() => setRedeemStep(null)} />
            </>
          )}
        </CelebrationModal>
      )}
    </SafeAreaView>
  );
}

type SecondaryButtonProps = {
  label: string;
  onPress: () => void;
  colors: (typeof Palette)['light' | 'dark'];
};

function SecondaryButton({ label, onPress, colors }: SecondaryButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        { borderColor: colors.border },
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.secondaryButtonText, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const NOTCH = 28;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
  },
  serifItalic: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.four,
  },
  backText: {
    fontSize: 16,
    fontWeight: '500',
  },
  topLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
  },

  // Pass
  pass: {
    borderRadius: 32,
    overflow: 'hidden',
  },
  passTop: {
    padding: Spacing.four,
    paddingBottom: Spacing.four,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  categoryText: {
    fontSize: 13,
    fontWeight: '500',
  },
  storeName: {
    fontSize: 48,
    fontWeight: '600',
    letterSpacing: 1,
    marginTop: Spacing.five,
  },
  reward: {
    fontSize: 24,
    marginTop: Spacing.one,
  },
  perforation: {
    height: NOTCH,
    justifyContent: 'center',
  },
  notch: {
    position: 'absolute',
    width: NOTCH,
    height: NOTCH,
    borderRadius: NOTCH / 2,
  },
  notchLeft: {
    left: -NOTCH / 2,
  },
  notchRight: {
    right: -NOTCH / 2,
  },
  dashes: {
    marginHorizontal: NOTCH,
    borderTopWidth: 1,
    borderStyle: 'dashed',
  },
  passBottom: {
    padding: Spacing.four,
    paddingTop: Spacing.three,
    alignItems: 'center',
  },
  figureLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  countdown: {
    fontFamily: Fonts.rounded,
    fontSize: 76,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    lineHeight: 84,
    letterSpacing: -2,
  },
  progressTrack: {
    alignSelf: 'stretch',
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(246, 242, 200, 0.14)',
    overflow: 'hidden',
    marginTop: Spacing.two,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  redeemed: {
    fontFamily: Fonts.rounded,
    fontSize: 40,
    fontWeight: '700',
    letterSpacing: 1,
    marginVertical: Spacing.two,
  },

  // Below the pass
  supportCopy: {
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
    marginTop: Spacing.four,
  },
  primaryButton: {
    height: 68,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.four,
  },
  primaryButtonText: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 2,
  },
  secondaryButton: {
    height: 52,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.three,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  emptyTitle: {
    fontSize: 40,
    fontWeight: '400',
    letterSpacing: -1,
    textAlign: 'center',
  },
});
