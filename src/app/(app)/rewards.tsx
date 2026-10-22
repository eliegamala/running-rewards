import { Link, router } from 'expo-router';
import { useState, useSyncExternalStore } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChooseStoreModal } from '@/components/choose-store-modal';
import { StoreLocationDetails } from '@/components/store-location';
import { Fonts, Palette, Spacing } from '@/constants/theme';
import {
  formatClockTime,
  formatCountdown,
  formatKm,
  useRewardCredit,
} from '@/hooks/use-reward-credit';
import { REWARD_DISTANCE_KM } from '@/lib/reward-credit';
import {
  distanceToStore,
  formatDistance,
  getNearbyState,
  sortByDistance,
  subscribe as subscribeToNearby,
} from '@/lib/nearby';
import {
  getCategory,
  getPrimaryLocation,
  getStore,
  getStoresState,
  type Store,
  subscribe as subscribeToStores,
} from '@/lib/stores';

// Where the runner spends their single reward credit at one participating store.
export default function RewardsScreen() {
  const scheme = useColorScheme();
  const colors = Palette[scheme === 'dark' ? 'dark' : 'light'];
  const { credit, status, remainingMs, kmToUnlock } = useRewardCredit();
  const redeemedStore = credit.redeemedStoreId ? getStore(credit.redeemedStoreId) : undefined;
  const selectedStore = credit.selectedStoreId ? getStore(credit.selectedStoreId) : undefined;
  // Unlocked with a store chosen: the live pass is active but not yet redeemed.
  const hasActivePass = status === 'unlocked' && selectedStore !== undefined;
  const [storeToChoose, setStoreToChoose] = useState<Store | null>(null);
  const { stores } = useSyncExternalStore(subscribeToStores, getStoresState);
  const nearby = useSyncExternalStore(subscribeToNearby, getNearbyState);
  // Nearest first once the phone knows where you are; otherwise the list's own order.
  const sortedStores = sortByDistance(stores, nearby);

  const openPass = () => {
    setStoreToChoose(null);
    router.navigate('/reward-pass');
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.canvas }]}
      edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.wordmark, { color: colors.text }]}>RUN</Text>

        <Text style={[styles.title, { color: colors.text }]}>
          Your <Text style={styles.serifItalic}>rewards</Text>
        </Text>
        <Text style={[styles.copy, { color: colors.textMuted }]}>
          One {REWARD_DISTANCE_KM} km run unlocks one reward. Spend it at any participating spot
          within an hour.
        </Text>

        <View style={[styles.emptyCard, { backgroundColor: colors.hero }]}>
          {status === 'locked' && (
            <>
              <Text style={[styles.eyebrow, { color: colors.accent }]}>NOTHING UNLOCKED YET</Text>
              <Text style={[styles.emptyTitle, { color: colors.heroText }]}>
                Your reward is{' '}
                <Text style={styles.serifItalic}>{formatKm(kmToUnlock)} km away.</Text>
              </Text>
              <Link href="/run" asChild>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.button,
                    { backgroundColor: colors.accent },
                    pressed && styles.pressed,
                  ]}>
                  <Text style={[styles.buttonText, { color: colors.accentText }]}>START A RUN</Text>
                </Pressable>
              </Link>
            </>
          )}

          {hasActivePass && (
            <>
              <Text style={[styles.eyebrow, { color: colors.accent }]}>REWARD ACTIVE</Text>
              <Text style={[styles.emptyTitle, { color: colors.heroText }]}>
                Ready at <Text style={styles.serifItalic}>{selectedStore.name}.</Text>
              </Text>
              <Text style={[styles.cardLabel, { color: colors.heroMuted }]}>Expires in</Text>
              <Text style={[styles.countdown, { color: colors.accent }]}>
                {formatCountdown(remainingMs)}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={openPass}
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: colors.accent },
                  pressed && styles.pressed,
                ]}>
                <Text style={[styles.buttonText, { color: colors.accentText }]}>
                  OPEN REWARD PASS
                </Text>
              </Pressable>
            </>
          )}

          {status === 'unlocked' && !hasActivePass && (
            <>
              <Text style={[styles.eyebrow, { color: colors.accent }]}>YOUR REWARD</Text>
              <Text style={[styles.emptyTitle, { color: colors.heroText }]}>
                One reward, <Text style={styles.serifItalic}>any spot.</Text>
              </Text>
              <Text style={[styles.cardLabel, { color: colors.heroMuted }]}>Expires in</Text>
              <Text style={[styles.countdown, { color: colors.accent }]}>
                {formatCountdown(remainingMs)}
              </Text>
            </>
          )}

          {status === 'redeemed' && (
            <>
              <Text style={[styles.eyebrow, { color: colors.accent }]}>REWARD USED</Text>
              <Text style={[styles.emptyTitle, { color: colors.heroText }]}>
                Enjoy it at{' '}
                <Text style={styles.serifItalic}>{redeemedStore?.name ?? 'your spot'}.</Text>
              </Text>
              {redeemedStore && (
                <Text style={[styles.cardReward, styles.serifItalic, { color: colors.heroText }]}>
                  {redeemedStore.reward}
                </Text>
              )}
              <Text style={[styles.cardLabel, { color: colors.heroMuted }]}>
                {credit.redeemedAt !== null
                  ? `Used at ${formatClockTime(credit.redeemedAt)}.`
                  : 'Reward used.'}
              </Text>
            </>
          )}

          {status === 'expired' && (
            <>
              <Text style={[styles.eyebrow, { color: colors.accent }]}>REWARD EXPIRED</Text>
              <Text style={[styles.emptyTitle, { color: colors.heroText }]}>
                This one <Text style={styles.serifItalic}>got away.</Text>
              </Text>
              <Text style={[styles.cardLabel, { color: colors.heroMuted }]}>
                Rewards last one hour after you unlock them.
              </Text>
            </>
          )}
        </View>

        <Text style={[styles.listTitle, { color: colors.text }]}>
          {status === 'unlocked' && !hasActivePass
            ? 'Choose where to use it'
            : 'Participating spots'}
        </Text>
        {sortedStores.map((store) => {
          const category = getCategory(store.category);
          const metres = distanceToStore(store, nearby);
          const isUsedHere = status === 'redeemed' && store.id === credit.redeemedStoreId;
          const isPassStore = hasActivePass && store.id === credit.selectedStoreId;
          const isDimmed =
            status === 'expired' ||
            (status === 'redeemed' && !isUsedHere) ||
            (hasActivePass && !isPassStore);

          return (
            <View
              key={store.id}
              style={[styles.row, { borderTopColor: colors.border }, isDimmed && styles.rowDimmed]}>
              <Text style={styles.rowEmoji}>{category.emoji}</Text>
              <View style={styles.rowText}>
                <Link href={{ pathname: '/store/[id]', params: { id: store.id } }} asChild>
                  <Pressable accessibilityRole="link" hitSlop={4}>
                    <Text style={[styles.rowName, { color: colors.text }]}>{store.name} ›</Text>
                  </Pressable>
                </Link>
                <Text style={[styles.rowReward, { color: colors.textMuted }]}>
                  {store.reward}
                  {metres !== null ? ` · ${formatDistance(metres)} away` : ''}
                </Text>
                <StoreLocationDetails
                  location={getPrimaryLocation(store)}
                  variant="row"
                  textColor={colors.text}
                  mutedColor={colors.textMuted}
                />
              </View>

              {isPassStore ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open reward pass for ${store.name}`}
                  onPress={openPass}
                  style={({ pressed }) => [
                    styles.useButton,
                    { backgroundColor: colors.accent },
                    pressed && styles.pressed,
                  ]}>
                  <Text style={[styles.useButtonText, { color: colors.accentText }]}>VIEW PASS</Text>
                </Pressable>
              ) : status === 'unlocked' && !hasActivePass ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Use reward at ${store.name}`}
                  onPress={() => setStoreToChoose(store)}
                  style={({ pressed }) => [
                    styles.useButton,
                    { backgroundColor: colors.hero },
                    pressed && styles.pressed,
                  ]}>
                  <Text style={[styles.useButtonText, { color: colors.heroText }]}>USE HERE</Text>
                </Pressable>
              ) : (
                <View
                  style={[
                    styles.distancePill,
                    { backgroundColor: isUsedHere ? colors.accent : colors.surface },
                  ]}>
                  <Text
                    style={[
                      styles.distanceText,
                      { color: isUsedHere ? colors.accentText : colors.text },
                    ]}>
                    {status === 'locked' ? '🔒 Locked' : isUsedHere ? 'USED' : 'Unavailable'}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {storeToChoose && (
        <ChooseStoreModal
          key={storeToChoose.id}
          store={storeToChoose}
          onClose={() => setStoreToChoose(null)}
          onSelected={openPass}
        />
      )}
    </SafeAreaView>
  );
}

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
  wordmark: {
    fontFamily: Fonts.rounded,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 4,
  },
  title: {
    fontSize: 44,
    fontWeight: '400',
    letterSpacing: -1.5,
    marginTop: Spacing.five,
  },
  copy: {
    fontSize: 15,
    lineHeight: 22,
    marginTop: Spacing.two,
    maxWidth: 320,
  },
  emptyCard: {
    borderRadius: 32,
    padding: Spacing.four,
    marginTop: Spacing.four,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  emptyTitle: {
    fontSize: 28,
    fontWeight: '400',
    letterSpacing: -0.6,
    lineHeight: 34,
    marginTop: Spacing.two,
  },
  button: {
    alignSelf: 'flex-start',
    height: 50,
    paddingHorizontal: Spacing.four,
    borderRadius: 999,
    justifyContent: 'center',
    marginTop: Spacing.four,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  listTitle: {
    fontSize: 20,
    fontWeight: '500',
    marginTop: 40,
    marginBottom: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowEmoji: {
    fontSize: 22,
  },
  rowText: {
    flex: 1,
  },
  rowName: {
    fontSize: 17,
    fontWeight: '500',
  },
  rowReward: {
    fontSize: 14,
    marginTop: 2,
  },
  distancePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  distanceText: {
    fontFamily: Fonts.rounded,
    fontSize: 15,
    fontWeight: '600',
  },
  cardReward: {
    fontSize: 20,
    marginTop: Spacing.two,
  },
  cardLabel: {
    fontSize: 15,
    marginTop: Spacing.three,
  },
  countdown: {
    fontFamily: Fonts.rounded,
    fontSize: 48,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    lineHeight: 54,
  },
  rowDimmed: {
    opacity: 0.45,
  },
  useButton: {
    height: 38,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    justifyContent: 'center',
  },
  useButtonText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
