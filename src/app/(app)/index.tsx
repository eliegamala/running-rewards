import { Link, router } from 'expo-router';
import { useState } from 'react';
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
import { StoreLocationDetails } from '@/components/store-location';
import { Fonts, Palette, type PaletteColors, Spacing } from '@/constants/theme';
import {
  formatClockTime,
  formatCountdown,
  formatKm,
  useRewardCredit,
} from '@/hooks/use-reward-credit';
import { REWARD_DISTANCE_KM, type RewardStatus } from '@/lib/reward-credit';
import {
  CATEGORIES,
  getCategory,
  getPrimaryLocation,
  getStore,
  STORES,
  type Store,
  type StoreCategory,
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
  /** Show the store's product photo, when it has one, instead of the cup illustration. */
  showProductImage?: boolean;
};

function StoreCard({ store, width, dark, colors, showProductImage = false }: StoreCardProps) {
  const category = getCategory(store.category);
  const foreground = dark ? colors.heroText : colors.text;
  const muted = dark ? colors.heroMuted : colors.textMuted;

  return (
    <Link href="/rewards" asChild>
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
        <Text style={[styles.storeCategory, { color: muted }]}>
          {category.emoji} {category.label}
        </Text>

        <View style={styles.storeArt}>
          {showProductImage && store.productImage ? (
            <Image
              source={store.productImage}
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

  // Scale key elements with the screen so the layout holds from iPhone mini to Pro Max.
  const headlineSize = Math.min(Math.round(width * 0.115), 52);
  const heroWidth = width - GUTTER * 2;
  const heroArtSize = heroWidth * 0.88;
  const cardWidth = Math.min(Math.round(width * 0.6), 280);

  // "Find your ritual" lists the participating spots for the chosen category.
  const ritual = getCategory(selectedCategory);
  const ritualStores = STORES.filter((store) => store.category === selectedCategory);

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
                {STORES.length} spots to run to
              </Text>
            </View>
            {/* Profile glyph drawn with Views, so no icon package is needed. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Profile"
              onPress={() => router.navigate('/profile')}
              hitSlop={8}
              style={({ pressed }) => [
                styles.profileButton,
                { backgroundColor: colors.hero },
                pressed && styles.pressed,
              ]}>
              <View style={[styles.profileHead, { backgroundColor: colors.heroText }]} />
              <View style={[styles.profileBody, { backgroundColor: colors.heroText }]} />
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
            count={String(STORES.length).padStart(2, '0')}
            colors={colors}
          />
          <Text style={[styles.sectionCopy, { color: colors.textMuted }]}>
            Run {REWARD_DISTANCE_KM} km, then pick any one of these for your reward.
          </Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth + Spacing.three}
          decelerationRate="fast"
          contentContainerStyle={styles.carousel}>
          {STORES.map((store, index) => (
            <StoreCard
              key={store.id}
              store={store}
              width={cardWidth}
              dark={index % 3 === 1}
              colors={colors}
            />
          ))}
        </ScrollView>

        {/* Worth the run, with product photos (same structure as above) */}
        <View style={[styles.section, styles.sectionSpacing]}>
          <SectionTitle
            lead="Poured at the"
            accent="finish"
            count={String(STORES.length).padStart(2, '0')}
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
          {STORES.map((store, index) => (
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

        {/* Categories */}
        <View style={[styles.section, styles.sectionSpacing]}>
          <SectionTitle lead="Find your" accent="ritual" colors={colors} />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryRow}>
          {CATEGORIES.map((category) => {
            const isSelected = category.id === selectedCategory;
            return (
              <Pressable
                key={category.id}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => setSelectedCategory(category.id)}
                style={[
                  styles.categoryPill,
                  isSelected
                    ? { backgroundColor: colors.hero, borderColor: colors.hero }
                    : { borderColor: colors.border },
                ]}>
                <Text style={styles.categoryEmoji}>{category.emoji}</Text>
                <Text
                  style={[
                    styles.categoryLabel,
                    { color: isSelected ? colors.heroText : colors.text },
                  ]}>
                  {category.label}
                </Text>
                <Text
                  style={[
                    styles.categoryCount,
                    { color: isSelected ? colors.heroMuted : colors.textMuted },
                  ]}>
                  {STORES.filter((store) => store.category === category.id).length}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={[styles.section, styles.ritualList]}>
          {ritualStores.length === 0 ? (
            <View style={[styles.ritualEmpty, { backgroundColor: colors.surface }]}>
              <Text style={[styles.ritualName, { color: colors.text }]}>
                No {ritual.label.toLowerCase()} spots yet
              </Text>
              <Text style={[styles.ritualReward, { color: colors.textMuted }]}>
                We&apos;re adding more places to run to. Any {REWARD_DISTANCE_KM} km run still
                unlocks a reward at the spots above.
              </Text>
            </View>
          ) : (
            ritualStores.map((store) => (
              <Link key={store.id} href="/rewards" asChild>
                <Pressable
                  accessibilityLabel={`${store.name}, ${store.reward}`}
                  style={({ pressed }) => [
                    styles.ritualRow,
                    { borderTopColor: colors.border },
                    pressed && styles.ritualRowPressed,
                  ]}>
                  <View style={[styles.ritualThumb, { backgroundColor: colors.surface }]}>
                    {store.productImage ? (
                      <Image
                        source={store.productImage}
                        resizeMode="contain"
                        accessibilityIgnoresInvertColors
                        style={styles.ritualImage}
                      />
                    ) : (
                      <CupArt
                        size={40}
                        category={store.category}
                        saucerColor="rgba(255, 255, 255, 0.6)"
                      />
                    )}
                  </View>
                  <View style={styles.ritualText}>
                    <Text style={[styles.ritualName, { color: colors.text }]}>{store.name}</Text>
                    <Text style={[styles.ritualReward, { color: colors.textMuted }]}>
                      {store.reward}
                    </Text>
                    <StoreLocationDetails
                      location={getPrimaryLocation(store)}
                      variant="row"
                      textColor={colors.text}
                      mutedColor={colors.textMuted}
                    />
                  </View>
                  <View style={[styles.ritualArrow, { backgroundColor: colors.hero }]}>
                    <Text style={[styles.arrow, { color: colors.heroText }]}>→</Text>
                  </View>
                </Pressable>
              </Link>
            ))
          )}
        </View>

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
  profileButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  profileHead: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginBottom: 2,
  },
  profileBody: {
    width: 22,
    height: 11,
    borderTopLeftRadius: 11,
    borderTopRightRadius: 11,
    marginBottom: -1,
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
  categoryRow: {
    paddingHorizontal: GUTTER,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
  },
  categoryEmoji: {
    fontSize: 16,
  },
  categoryLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  categoryCount: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  ritualList: {
    marginTop: Spacing.three,
  },
  ritualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ritualRowPressed: {
    opacity: 0.7,
  },
  ritualThumb: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ritualImage: {
    width: 44,
    height: 50,
  },
  ritualText: {
    flex: 1,
  },
  ritualName: {
    fontSize: 17,
    fontWeight: '500',
  },
  ritualReward: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
  },
  ritualArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
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
