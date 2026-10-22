import { Image } from 'expo-image';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useState, useSyncExternalStore } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChooseStoreModal } from '@/components/choose-store-modal';
import { CupArt } from '@/components/cup-art';
import { StoreLocationDetails } from '@/components/store-location';
import { Fonts, Palette, type PaletteColors, Spacing } from '@/constants/theme';
import { formatKm, useRewardCredit } from '@/hooks/use-reward-credit';
import { distanceToStore, formatDistance, getNearbyState, subscribe as subscribeToNearby } from '@/lib/nearby';
import { REWARD_DISTANCE_KM } from '@/lib/reward-credit';
import {
  getCategory,
  getStore,
  getStoresState,
  type Store,
  subscribe as subscribeToStores,
} from '@/lib/stores';

const GUTTER = Spacing.four;

/** Venue photos (swipeable), else the product cut-out or cup on the dark green card. */
function Header({ store, width, colors }: { store: Store; width: number; colors: PaletteColors }) {
  const height = Math.min(Math.round(width * 0.82), 420);
  const [page, setPage] = useState(0);

  if (store.venueImageUrls.length === 0) {
    return (
      <View style={[styles.header, { height, backgroundColor: colors.hero }]}>
        {store.productImageUrl ? (
          <Image
            source={{ uri: store.productImageUrl }}
            style={{ width: height * 0.62, height: height * 0.62 }}
            contentFit="contain"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <CupArt size={height * 0.62} category={store.category} saucerColor="rgba(246, 242, 200, 0.08)" />
        )}
      </View>
    );
  }

  return (
    <View style={{ height }}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) =>
          setPage(Math.round(event.nativeEvent.contentOffset.x / width))
        }>
        {store.venueImageUrls.map((uri, index) => (
          <Image
            key={uri}
            source={{ uri }}
            style={{ width, height, backgroundColor: colors.surface }}
            contentFit="cover"
            transition={200}
            accessibilityLabel={`${store.name}, photo ${index + 1} of ${store.venueImageUrls.length}`}
          />
        ))}
      </ScrollView>
      {store.venueImageUrls.length > 1 && (
        <View style={styles.dots} pointerEvents="none">
          {store.venueImageUrls.map((uri, index) => (
            <View
              key={uri}
              style={[styles.dot, { opacity: index === page ? 1 : 0.45, width: index === page ? 18 : 6 }]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

/** Café page: photos, reward, distance, where to find it, and what you can do right now. */
export default function StoreScreen() {
  const scheme = useColorScheme();
  const colors = Palette[scheme === 'dark' ? 'dark' : 'light'];
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const storesState = useSyncExternalStore(subscribeToStores, getStoresState);
  const nearby = useSyncExternalStore(subscribeToNearby, getNearbyState);
  const { credit, status, kmToUnlock } = useRewardCredit();
  const [choosing, setChoosing] = useState(false);

  const store = typeof id === 'string' ? storesState.stores.find((s) => s.id === id) : undefined;
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const backButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={goBack}
      hitSlop={8}
      style={({ pressed }) => [
        styles.back,
        { top: insets.top + Spacing.two, backgroundColor: colors.canvas },
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.backText, { color: colors.text }]}>‹</Text>
    </Pressable>
  );

  if (!store) {
    return (
      <View style={[styles.container, styles.missing, { backgroundColor: colors.canvas }]}>
        {backButton}
        <Text style={[styles.name, { color: colors.text }]}>
          {storesState.status === 'loading' ? 'Loading…' : 'Spot not found.'}
        </Text>
        {storesState.status !== 'loading' && (
          <Text style={[styles.copy, { color: colors.textMuted }]}>
            This spot isn&apos;t on the list any more.
          </Text>
        )}
      </View>
    );
  }

  const category = getCategory(store.category);
  const distance = distanceToStore(store, nearby);
  const selected = credit.selectedStoreId ? getStore(credit.selectedStoreId) : undefined;
  const isPassHere = status === 'unlocked' && credit.selectedStoreId === store.id;
  const canChoose = status === 'unlocked' && !credit.selectedStoreId;

  let action: { eyebrow: string; title: string; button?: { label: string; onPress: () => void } };
  if (isPassHere) {
    action = {
      eyebrow: 'REWARD ACTIVE',
      title: 'Your pass is ready for this spot.',
      button: { label: 'VIEW REWARD PASS', onPress: () => router.navigate('/reward-pass') },
    };
  } else if (canChoose) {
    action = {
      eyebrow: 'YOUR REWARD IS UNLOCKED',
      title: `Use it at ${store.name}?`,
      button: { label: 'USE MY REWARD HERE', onPress: () => setChoosing(true) },
    };
  } else if (status === 'unlocked') {
    action = {
      eyebrow: 'REWARD IN USE',
      title: `Your reward is set for ${selected?.name ?? 'another spot'}.`,
    };
  } else {
    action = {
      eyebrow: status === 'locked' ? 'NOT UNLOCKED YET' : 'NEXT REWARD',
      title: `Run ${formatKm(status === 'locked' ? kmToUnlock : REWARD_DISTANCE_KM)} km to unlock it here.`,
      button: { label: 'START A RUN', onPress: () => router.navigate('/run') },
    };
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.canvas }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.five }}
        showsVerticalScrollIndicator={false}>
        <Header store={store} width={width} colors={colors} />

        <View style={styles.body}>
          <View style={styles.chips}>
            <View style={[styles.chip, { backgroundColor: colors.surface }]}>
              <Text style={[styles.chipText, { color: colors.text }]}>
                {category.emoji} {category.label}
              </Text>
            </View>
            {distance !== null && (
              <View style={[styles.chip, { backgroundColor: colors.surface }]}>
                <Text style={[styles.chipText, { color: colors.text }]}>
                  📍 {formatDistance(distance)} away
                </Text>
              </View>
            )}
          </View>

          <Text style={[styles.name, { color: colors.text }]}>{store.name}</Text>
          <Text
            style={[
              styles.reward,
              store.rewardConfirmed
                ? [styles.serifItalic, { color: colors.text }]
                : { color: colors.textMuted },
            ]}>
            {store.reward}
          </Text>
          {store.description && (
            <Text style={[styles.copy, { color: colors.textMuted }]}>{store.description}</Text>
          )}

          <View style={[styles.actionCard, { backgroundColor: colors.hero }]}>
            <Text style={[styles.eyebrow, { color: colors.accent }]}>{action.eyebrow}</Text>
            <Text style={[styles.actionTitle, { color: colors.heroText }]}>{action.title}</Text>
            {action.button && (
              <Pressable
                accessibilityRole="button"
                onPress={action.button.onPress}
                style={({ pressed }) => [
                  styles.actionButton,
                  { backgroundColor: colors.accent },
                  pressed && styles.pressed,
                ]}>
                <Text style={[styles.actionButtonText, { color: colors.accentText }]}>
                  {action.button.label}
                </Text>
              </Pressable>
            )}
          </View>

          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {store.locations.length > 1 ? 'WHERE TO FIND THEM' : 'WHERE TO FIND IT'}
          </Text>
          {store.locations.map((location, index) => (
            <View
              key={`${location.address}-${index}`}
              style={[styles.location, { borderTopColor: colors.border }]}>
              <StoreLocationDetails
                location={location}
                variant="pass"
                textColor={colors.text}
                mutedColor={colors.textMuted}
                borderColor={colors.border}
              />
            </View>
          ))}

          <Link href="/rewards" asChild>
            <Pressable accessibilityRole="link" hitSlop={8} style={styles.allSpots}>
              <Text style={[styles.allSpotsText, { color: colors.textMuted }]}>
                Your reward works at any spot on the list ›
              </Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>

      {backButton}

      {choosing && (
        <ChooseStoreModal
          store={store}
          onClose={() => setChoosing(false)}
          onSelected={() => {
            setChoosing(false);
            router.navigate('/reward-pass');
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  missing: {
    justifyContent: 'center',
    paddingHorizontal: GUTTER,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  serifItalic: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
  },
  header: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dots: {
    position: 'absolute',
    bottom: Spacing.three,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  back: {
    position: 'absolute',
    left: GUTTER,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: {
    fontSize: 26,
    lineHeight: 28,
    fontWeight: '500',
    marginTop: -2,
  },
  body: {
    paddingHorizontal: GUTTER,
    paddingTop: Spacing.four,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  name: {
    fontSize: 38,
    fontWeight: '400',
    letterSpacing: -1.2,
    lineHeight: 44,
    marginTop: Spacing.three,
  },
  reward: {
    fontSize: 21,
    lineHeight: 28,
    marginTop: Spacing.one,
  },
  copy: {
    fontSize: 15,
    lineHeight: 22,
    marginTop: Spacing.three,
  },
  actionCard: {
    borderRadius: 28,
    padding: Spacing.four,
    marginTop: Spacing.four,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  actionTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '400',
    letterSpacing: -0.4,
    marginTop: Spacing.two,
  },
  actionButton: {
    height: 54,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.three,
  },
  actionButtonText: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 40,
  },
  location: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.two,
  },
  allSpots: {
    marginTop: Spacing.four,
  },
  allSpotsText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
