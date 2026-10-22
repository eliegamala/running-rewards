import { Link, router } from 'expo-router';
import { useState, useSyncExternalStore } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CupArt } from '@/components/cup-art';
import { ProfileAvatar } from '@/components/profile-avatar';
import { StoreLogo } from '@/components/store-logo';
import { Fonts, Palette, type PaletteColors, Spacing } from '@/constants/theme';
import {
  formatClockTime,
  formatCountdown,
  formatKm,
  useRewardCredit,
} from '@/hooks/use-reward-credit';
import {
  distanceToStore,
  formatDistance,
  getNearbyState,
  refreshNearby,
  sortByDistance,
  subscribe as subscribeToNearby,
} from '@/lib/nearby';
import { REWARD_DISTANCE_KM, type RewardStatus } from '@/lib/reward-credit';
import {
  CATEGORIES,
  countLabel,
  freshOrder,
  getCategory,
  getStore,
  getStoresState,
  productImageFor,
  signatureProduct,
  type Store,
  type StoreCategory,
  subscribe as subscribeToStores,
} from '@/lib/stores';

const GUTTER = Spacing.four;

const STEPS = [
  { title: `Run ${REWARD_DISTANCE_KM} km in one go`, tag: 'Run' },
  { title: 'Pick any spot for your reward', tag: 'Choose' },
  { title: 'Use it within the hour', tag: 'Enjoy' },
];

type HeroCopy = {
  chip: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  figure: string;
  figureUnit?: string;
  figureLabel: string;
  labelAbove?: boolean;
  button: string;
  href: '/rewards' | '/reward-pass';
};

// The featured card follows the single reward credit through its lifecycle.
function getHeroCopy(
  status: RewardStatus,
  remainingMs: number,
  kmToUnlock: number,
  selectedStore: Store | undefined,
  redeemedStore: Store | undefined,
  redeemedAt: number | null,
): HeroCopy {
  switch (status) {
    case 'unlocked':
      // A store has been chosen: the live pass is active until redeemed or expired.
      if (selectedStore) {
        return {
          chip: 'Active',
          eyebrow: 'REWARD ACTIVE',
          title: selectedStore.name,
          subtitle: selectedStore.reward,
          figure: formatCountdown(remainingMs),
          figureLabel: 'Expires in',
          labelAbove: true,
          button: 'Open pass',
          href: '/reward-pass',
        };
      }
      return {
        chip: 'Unlocked',
        eyebrow: 'REWARD UNLOCKED',
        title: 'Choose your reward',
        subtitle: 'Use at any participating spot',
        figure: formatCountdown(remainingMs),
        figureLabel: 'Expires in',
        labelAbove: true,
        button: 'Choose spot',
        href: '/rewards',
      };
    case 'redeemed':
      return {
        chip: 'Used',
        eyebrow: 'REWARD USED',
        title: redeemedStore?.name ?? 'Reward used',
        subtitle: redeemedStore?.reward ?? 'Enjoy it',
        figure: redeemedAt === null ? '--:--' : formatClockTime(redeemedAt),
        figureLabel: 'Used at',
        labelAbove: true,
        button: 'View reward',
        href: '/rewards',
      };
    case 'expired':
      return {
        chip: 'Expired',
        eyebrow: 'REWARD EXPIRED',
        title: 'This one got away',
        subtitle: 'Rewards last an hour after unlocking',
        figure: '00:00',
        figureLabel: 'Expired',
        labelAbove: true,
        button: 'View rewards',
        href: '/rewards',
      };
    default:
      return {
        chip: 'Locked',
        eyebrow: 'RUN FOR YOUR COFFEE',
        title: 'Your next reward',
        subtitle: 'Use it at any participating spot',
        figure: formatKm(kmToUnlock),
        figureUnit: ' km',
        figureLabel: 'to unlock',
        button: 'View spots',
        href: '/rewards',
      };
  }
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning ☀️';
  if (hour < 17) return 'Good afternoon 🌤️';
  return 'Good evening 🌙';
}

type SectionTitleProps = {
  lead: string;
  accent: string;
  count?: string;
  colors: PaletteColors;
};

function SectionTitle({ lead, accent, count, colors }: SectionTitleProps) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        {lead} <Text style={styles.serifItalic}>{accent}</Text>
      </Text>
      {count && <Text style={[styles.superscript, { color: colors.textMuted }]}>{count}</Text>}
    </View>
  );
}

type StoreCardProps = {
  store: Store;
  width: number;
  dark: boolean;
  colors: PaletteColors;
  /** Show the product photo (or a stand-in) instead of the cup illustration. */
  showProductImage?: boolean;
};

function StoreCard({ store, width, dark, colors, showProductImage = false }: StoreCardProps) {
  const category = getCategory(store.category);
  const signature = showProductImage ? signatureProduct(store) : null;
  const foreground = dark ? colors.heroText : colors.text;
  const muted = dark ? colors.heroMuted : colors.textMuted;

  return (
    <Link href={{ pathname: '/store/[id]', params: { id: store.id } }} asChild>
      <Pressable
        accessibilityLabel={`${store.name}, ${store.reward} with a ${REWARD_DISTANCE_KM} kilometre reward`}
        style={({ pressed }) => [
          styles.storeCard,
          { width, backgroundColor: dark ? colors.hero : colors.surface },
          pressed && styles.pressed,
        ]}>
        <Text style={[styles.storeName, { color: foreground }]} numberOfLines={1}>
          {store.name}
        </Text>
        <Text style={[styles.storeCategory, { color: muted }]} numberOfLines={1}>
          {signature ? signature.name : `${category.emoji} ${category.label}`}
        </Text>

        <View style={styles.storeArt}>
          {showProductImage ? (
            <Image
              source={productImageFor(store)}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
              style={{ width: width * 0.56, height: width * 0.56 }}
            />
          ) : (
            <CupArt
              size={width * 0.56}
              category={store.category}
              saucerColor={dark ? 'rgba(246, 242, 200, 0.1)' : 'rgba(255, 255, 255, 0.6)'}
            />
          )}
        </View>

        <Text style={[styles.storeReward, { color: foreground }]} numberOfLines={1}>
          {store.reward}
        </Text>

        <View
          style={[
            styles.storeFooter,
            { borderTopColor: dark ? 'rgba(246, 242, 200, 0.16)' : colors.border },
          ]}>
          <View>
            <Text style={[styles.runLabel, { color: muted }]}>RUN</Text>
            <Text style={[styles.storeDistance, { color: foreground }]}>
              {REWARD_DISTANCE_KM}
              <Text style={styles.storeDistanceUnit}> km</Text>
            </Text>
          </View>
          <View
            style={[styles.arrowCircle, { backgroundColor: dark ? colors.accent : colors.hero }]}>
            <Text style={[styles.arrow, { color: dark ? colors.accentText : colors.heroText }]}>
              →
            </Text>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

export default function HomeScreen() {
  const scheme = useColorScheme();
  const colors = Palette[scheme === 'dark' ? 'dark' : 'light'];
  const { width } = useWindowDimensions();
  const [greeting] = useState(getGreeting);
  const [selectedCategory, setSelectedCategory] = useState<StoreCategory>('coffee');
  const { stores, status: storesStatus } = useSyncExternalStore(subscribeToStores, getStoresState);
  const nearby = useSyncExternalStore(subscribeToNearby, getNearbyState);
  // Both carousels reshuffle every 5 hours (each in its own order) to keep Home fresh.
  const worthTheRun = freshOrder(stores, 1);
  const pouredAtFinish = freshOrder(stores, 2);

  // Scale key elements with the screen so the layout holds from iPhone mini to Pro Max.
  const headlineSize = Math.min(Math.round(width * 0.115), 52);
  const heroWidth = width - GUTTER * 2;
  const heroArtSize = heroWidth * 0.88;
  const cardWidth = Math.min(Math.round(width * 0.6), 280);

  // Category tiles: one row of three, sized to the screen.
  const tileWidth = Math.floor((width - GUTTER * 2 - Spacing.two * 2) / 3);
  const ritualCardWidth = Math.min(Math.round(width * 0.42), 190);
  // "Find your ritual": spots for the chosen craving, nearest first.
  const ritual = getCategory(selectedCategory);
  const ritualStores = sortByDistance(
    stores.filter((store) => store.category === selectedCategory),
    nearby,
  );
  const countFor = (id: StoreCategory) => stores.filter((store) => store.category === id).length;

  const { credit, status, remainingMs, kmToUnlock } = useRewardCredit();
  const hero = getHeroCopy(
    status,
    remainingMs,
    kmToUnlock,
    credit.selectedStoreId ? getStore(credit.selectedStoreId) : undefined,
    credit.redeemedStoreId ? getStore(credit.redeemedStoreId) : undefined,
    credit.redeemedAt,
  );

  const heroFigureLabel = (
    <Text style={[styles.heroDistanceLabel, { color: colors.heroMuted }]}>
      {hero.figureLabel}
    </Text>
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.canvas }]}
      edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={[styles.section, styles.topBar]}>
          <Text style={[styles.wordmark, { color: colors.text }]}>RUN</Text>
          <View style={styles.topActions}>
            <View style={[styles.topPill, { borderColor: colors.border }]}>
              <Text style={[styles.topPillText, { color: colors.textMuted }]}>
                {stores.length === 1 ? '1 spot' : `${stores.length} spots`} to run to
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Profile"
              onPress={() => router.navigate('/profile')}
              hitSlop={8}
              style={({ pressed }) => pressed && styles.pressed}>
              <ProfileAvatar size={36} colors={colors} />
            </Pressable>
          </View>
        </View>

        <View style={[styles.section, styles.intro]}>
          <Text style={[styles.greeting, { color: colors.textMuted }]}>{greeting}</Text>
          <Text
            style={[
              styles.headline,
              { color: colors.text, fontSize: headlineSize, lineHeight: headlineSize * 1.08 },
            ]}>
            Where are we
          </Text>
          <Text
            style={[
              styles.headline,
              {
                color: colors.textMuted,
                opacity: 0.55,
                fontSize: headlineSize,
                lineHeight: headlineSize * 1.08,
                paddingLeft: width * 0.12,
              },
            ]}>
            running
          </Text>
          <Text
            style={[
              styles.headline,
              styles.serifItalic,
              { color: colors.text, fontSize: headlineSize, lineHeight: headlineSize * 1.15 },
            ]}>
            today?
          </Text>
          <Text style={[styles.introCopy, { color: colors.textMuted }]}>
            Run {REWARD_DISTANCE_KM} km, unlock a reward, and spend it at any café or matcha bar
            on the list. Then go enjoy it.
          </Text>
        </View>

        {/* Featured reward */}
        <View style={styles.section}>
          <View
            style={[
              styles.hero,
              { backgroundColor: colors.hero, height: Math.max(heroWidth * 1.05, 360) },
            ]}>
            <View
              style={{
                position: 'absolute',
                top: -heroArtSize * 0.14,
                right: -heroArtSize * 0.3,
              }}>
              <CupArt
                size={heroArtSize}
                category="coffee"
                saucerColor="rgba(246, 242, 200, 0.08)"
              />
            </View>

            <View style={styles.chipRow}>
              <View style={[styles.chip, { backgroundColor: colors.accent }]}>
                <Text style={[styles.chipText, { color: colors.accentText }]}>{hero.chip}</Text>
              </View>
              <View style={[styles.chip, styles.chipGlass]}>
                <Text style={[styles.chipText, { color: colors.heroText }]}>Any spot</Text>
              </View>
            </View>

            <View style={styles.heroPanel}>
              <Text style={[styles.eyebrow, { color: colors.accent }]}>{hero.eyebrow}</Text>
              <Text
                style={[styles.heroName, { color: colors.heroText }]}
                numberOfLines={2}
                adjustsFontSizeToFit>
                {hero.title}
              </Text>
              <Text style={[styles.heroReward, styles.serifItalic, { color: colors.heroText }]}>
                {hero.subtitle}
              </Text>

              <View style={styles.heroFooter}>
                <View>
                  {hero.labelAbove && heroFigureLabel}
                  <Text style={[styles.heroDistance, { color: colors.accent }]}>
                    {hero.figure}
                    {hero.figureUnit && (
                      <Text style={styles.heroDistanceUnit}>{hero.figureUnit}</Text>
                    )}
                  </Text>
                  {!hero.labelAbove && heroFigureLabel}
                </View>

                <Link href={hero.href} asChild>
                  <Pressable
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.pillButton,
                      { backgroundColor: colors.heroText },
                      pressed && styles.pressed,
                    ]}>
                    <Text style={[styles.pillButtonText, { color: colors.accentText }]}>
                      {hero.button}
                    </Text>
                    <View style={[styles.pillButtonIcon, { backgroundColor: colors.hero }]}>
                      <Text style={[styles.arrow, { color: colors.accent }]}>↗</Text>
                    </View>
                  </Pressable>
                </Link>
              </View>
            </View>
          </View>
        </View>

        {/* Worth the run */}
        <View style={[styles.section, styles.sectionSpacing]}>
          <SectionTitle
            lead="Worth the"
            accent="run"
            count={String(stores.length).padStart(2, '0')}
            colors={colors}
          />
          <Text style={[styles.sectionCopy, { color: colors.textMuted }]}>
            {storesStatus === 'loading'
              ? 'Loading the spots…'
              : storesStatus === 'error'
                ? "Couldn't load the spots. Check your connection."
                : `Run ${REWARD_DISTANCE_KM} km, then pick any one of these for your reward.`}
          </Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth + Spacing.three}
          decelerationRate="fast"
          contentContainerStyle={styles.carousel}>
          {worthTheRun.map((store, index) => (
            <StoreCard
              key={store.id}
              store={store}
              width={cardWidth}
              dark={index % 3 === 1}
              colors={colors}
            />
          ))}
        </ScrollView>

        {/* Worth the run, with product photos */}
        <View style={[styles.section, styles.sectionSpacing]}>
          <SectionTitle
            lead="Poured at the"
            accent="finish"
            count={String(stores.length).padStart(2, '0')}
            colors={colors}
          />
          <Text style={[styles.sectionCopy, { color: colors.textMuted }]}>
            A taste of what&apos;s waiting when you get there.
          </Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth + Spacing.three}
          decelerationRate="fast"
          contentContainerStyle={styles.carousel}>
          {pouredAtFinish.map((store, index) => (
            <StoreCard
              key={store.id}
              store={store}
              width={cardWidth}
              dark={index % 3 === 1}
              colors={colors}
              showProductImage
            />
          ))}
        </ScrollView>

        {/* Find your ritual: pick a craving, see the nearest spots for it */}
        <View style={[styles.section, styles.sectionSpacing]}>
          <SectionTitle lead="Find your" accent="ritual" colors={colors} />
          <Text style={[styles.sectionCopy, { color: colors.textMuted }]}>
            What are you running for?
          </Text>
          <View style={styles.tileGrid}>
            {CATEGORIES.map((category) => {
              const count = countFor(category.id);
              const isSelected = category.id === selectedCategory;
              return (
                <Pressable
                  key={category.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected, disabled: count === 0 }}
                  accessibilityLabel={`${category.label}, ${count === 0 ? 'coming soon' : countLabel(count)}`}
                  disabled={count === 0}
                  onPress={() => setSelectedCategory(category.id)}
                  style={({ pressed }) => [
                    styles.tile,
                    { width: tileWidth, backgroundColor: isSelected ? colors.hero : colors.surface },
                    count === 0 && styles.tileSoon,
                    pressed && styles.pressed,
                  ]}>
                  <Text style={styles.tileEmoji}>{category.emoji}</Text>
                  <View>
                    <Text
                      style={[styles.tileLabel, { color: isSelected ? colors.heroText : colors.text }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}>
                      {category.label}
                    </Text>
                    <Text
                      style={[
                        styles.tileCount,
                        { color: isSelected ? colors.heroMuted : colors.textMuted },
                      ]}>
                      {count === 0 ? 'Soon' : countLabel(count)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {nearby.permission === 'undetermined' && ritualStores.length > 0 && (
            <Pressable
              accessibilityRole="button"
              onPress={() => void refreshNearby({ ask: true })}
              style={({ pressed }) => [
                styles.nearestButton,
                { borderColor: colors.border },
                pressed && styles.pressed,
              ]}>
              <Text style={[styles.nearestText, { color: colors.text }]}>📍 Show nearest first</Text>
            </Pressable>
          )}
        </View>

        {/* Spots for the chosen craving: a swipeable row, nearest first */}
        {ritualStores.length === 0 ? (
          <View style={styles.section}>
            <View style={[styles.ritualEmpty, { backgroundColor: colors.surface }]}>
              <Text style={[styles.ritualName, { color: colors.text }]}>
                No {ritual.label.toLowerCase()} yet
              </Text>
              <Text style={[styles.ritualReward, { color: colors.textMuted }]}>
                We&apos;re adding more places to run to.
              </Text>
            </View>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={ritualCardWidth + Spacing.two}
            decelerationRate="fast"
            contentContainerStyle={styles.ritualRow}>
            {ritualStores.map((store) => {
              const metres = distanceToStore(store, nearby);
              return (
                <Link
                  key={store.id}
                  href={{ pathname: '/store/[id]', params: { id: store.id } }}
                  asChild>
                  <Pressable
                    accessibilityLabel={`${store.name}, ${store.reward}${metres !== null ? `, ${formatDistance(metres)} away` : ''}`}
                    style={({ pressed }) => [
                      styles.ritualCard,
                      { width: ritualCardWidth, backgroundColor: colors.surface },
                      pressed && styles.pressed,
                    ]}>
                    <StoreLogo store={store} size={ritualCardWidth - 28} colors={colors} />
                    <Text style={[styles.ritualName, { color: colors.text }]} numberOfLines={2}>
                      {store.name}
                    </Text>
                    <Text style={[styles.ritualReward, { color: colors.textMuted }]} numberOfLines={1}>
                      {store.reward}
                    </Text>
                    <View style={styles.ritualFooter}>
                      <Text style={[styles.ritualDistance, { color: colors.text }]}>
                        {metres !== null ? `📍 ${formatDistance(metres)}` : ' '}
                      </Text>
                      <View style={[styles.ritualArrow, { backgroundColor: colors.hero }]}>
                        <Text style={[styles.arrow, { color: colors.heroText }]}>→</Text>
                      </View>
                    </View>
                  </Pressable>
                </Link>
              );
            })}
          </ScrollView>
        )}

        {/* How it works */}
        <View style={[styles.section, styles.sectionSpacing]}>
          <SectionTitle lead="How it" accent="works" colors={colors} />
          <View style={styles.steps}>
            {STEPS.map((step, index) => (
              <View key={step.tag} style={[styles.stepRow, { borderTopColor: colors.border }]}>
                <Text style={[styles.stepNumber, { color: colors.textMuted }]}>
                  {String(index + 1).padStart(2, '0')}
                </Text>
                <Text style={[styles.stepTitle, { color: colors.text }]}>{step.title}</Text>
                <Text style={[styles.stepTag, { color: colors.textMuted }]}>{step.tag}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Running CTA */}
        <View style={[styles.section, styles.sectionSpacing]}>
          <View style={[styles.cta, { backgroundColor: colors.hero }]}>
            <Text style={[styles.eyebrow, { color: colors.accent }]}>READY TO RUN?</Text>
            <Text style={[styles.ctaTitle, { color: colors.heroText }]}>
              Earn your{'\n'}
              <Text style={styles.serifItalic}>next coffee.</Text>
            </Text>
            <Text style={[styles.ctaCopy, { color: colors.heroMuted }]}>
              Every kilometre brings a reward closer.
            </Text>
            <Link href="/run" asChild>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.pillButton,
                  styles.ctaButton,
                  { backgroundColor: colors.accent },
                  pressed && styles.pressed,
                ]}>
                <Text style={[styles.ctaButtonText, { color: colors.accentText }]}>
                  START A RUN
                </Text>
                <View style={[styles.pillButtonIcon, { backgroundColor: colors.hero }]}>
                  <Text style={[styles.arrow, { color: colors.accent }]}>→</Text>
                </View>
              </Pressable>
            </Link>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
  },
  section: {
    paddingHorizontal: GUTTER,
  },
  sectionSpacing: {
    marginTop: 40,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  serifItalic: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
  },

  // Header
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  wordmark: {
    fontFamily: Fonts.rounded,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 4,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  topPill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
  },
  topPillText: {
    fontSize: 13,
    fontWeight: '500',
  },
  intro: {
    marginTop: Spacing.five,
    marginBottom: Spacing.four,
  },
  greeting: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: Spacing.two,
  },
  headline: {
    fontWeight: '400',
    letterSpacing: -1.5,
  },
  introCopy: {
    fontSize: 15,
    lineHeight: 22,
    marginTop: Spacing.three,
    maxWidth: 320,
  },

  // Featured reward
  hero: {
    borderRadius: 32,
    overflow: 'hidden',
    padding: Spacing.two,
    justifyContent: 'space-between',
  },
  chipRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    padding: Spacing.two,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  chipGlass: {
    backgroundColor: 'rgba(246, 242, 200, 0.14)',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  heroPanel: {
    backgroundColor: 'rgba(18, 32, 18, 0.55)',
    borderRadius: 24,
    padding: Spacing.four,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  heroName: {
    fontSize: 40,
    fontWeight: '400',
    letterSpacing: -1,
    marginTop: Spacing.two,
  },
  heroReward: {
    fontSize: 21,
    marginTop: 2,
  },
  heroFooter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: Spacing.four,
  },
  heroDistance: {
    fontFamily: Fonts.rounded,
    fontSize: 36,
    fontWeight: '600',
    lineHeight: 38,
  },
  heroDistanceUnit: {
    fontSize: 18,
    fontWeight: '500',
  },
  heroDistanceLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  pillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingLeft: 18,
    paddingRight: 5,
    height: 46,
    borderRadius: 999,
  },
  pillButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  pillButtonIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    fontSize: 16,
    fontWeight: '600',
  },

  // Sections
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  sectionTitle: {
    fontSize: 30,
    fontWeight: '400',
    letterSpacing: -0.8,
  },
  superscript: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
    marginTop: 2,
  },
  sectionCopy: {
    fontSize: 15,
    lineHeight: 21,
    marginTop: Spacing.one,
  },

  // Store cards
  carousel: {
    paddingHorizontal: GUTTER,
    paddingTop: Spacing.three,
    gap: Spacing.three,
  },
  storeCard: {
    borderRadius: 28,
    padding: 18,
  },
  storeName: {
    fontSize: 19,
    fontWeight: '500',
    letterSpacing: -0.3,
  },
  storeCategory: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  storeArt: {
    alignItems: 'center',
    paddingVertical: Spacing.four,
  },
  storeReward: {
    fontSize: 15,
    fontWeight: '500',
  },
  storeFooter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 14,
    paddingTop: 12,
  },
  runLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  storeDistance: {
    fontFamily: Fonts.rounded,
    fontSize: 30,
    fontWeight: '600',
    lineHeight: 34,
  },
  storeDistanceUnit: {
    fontSize: 16,
    fontWeight: '500',
  },
  arrowCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Categories
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  tile: {
    borderRadius: 22,
    padding: 12,
    minHeight: 104,
    justifyContent: 'space-between',
  },
  tileSoon: {
    opacity: 0.55,
  },
  tileEmoji: {
    fontSize: 26,
  },
  tileLabel: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: Spacing.two,
  },
  tileCount: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  nearestButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginTop: Spacing.three,
  },
  nearestText: {
    fontSize: 14,
    fontWeight: '600',
  },
  ritualRow: {
    paddingHorizontal: GUTTER,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  ritualCard: {
    borderRadius: 24,
    padding: 14,
  },
  ritualName: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
    marginTop: Spacing.two,
  },
  ritualReward: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  ritualFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
  },
  ritualDistance: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  ritualArrow: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ritualEmpty: {
    borderRadius: 24,
    padding: Spacing.four,
  },

  // How it works
  steps: {
    marginTop: Spacing.three,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stepNumber: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  stepTitle: {
    flex: 1,
    fontSize: 16,
  },
  stepTag: {
    fontSize: 12,
    fontWeight: '500',
  },

  // CTA
  cta: {
    borderRadius: 32,
    paddingHorizontal: Spacing.four,
    paddingVertical: 36,
    alignItems: 'center',
  },
  ctaTitle: {
    fontSize: 36,
    fontWeight: '400',
    letterSpacing: -1,
    lineHeight: 40,
    textAlign: 'center',
    marginTop: Spacing.three,
  },
  ctaCopy: {
    fontSize: 15,
    marginTop: Spacing.two,
    textAlign: 'center',
  },
  ctaButton: {
    marginTop: Spacing.four,
    height: 56,
    paddingLeft: Spacing.four,
    paddingRight: 8,
    gap: Spacing.three,
  },
  ctaButtonText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
});
