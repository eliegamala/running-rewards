import { router } from 'expo-router';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Notice, PrimaryButton, SecondaryButton, usePalette } from '@/components/auth-ui';
import { Fonts, Spacing } from '@/constants/theme';
import { enterDevPreview } from '@/lib/auth';
import { REWARD_DISTANCE_KM } from '@/lib/reward-credit';
import { isSupabaseConfigured, supabaseConfigProblem } from '@/lib/supabase';

const GUTTER = Spacing.four;

const STEPS = [
  { title: 'Keep running with Strava', detail: 'Track your runs the way you already do.' },
  {
    title: `Hit ${REWARD_DISTANCE_KM} km`,
    detail: 'A qualifying run unlocks one reward.',
  },
  {
    title: 'Spend it locally',
    detail: 'Use it at any participating café within the hour.',
  },
];

export default function WelcomeScreen() {
  const colors = usePalette();
  const { width } = useWindowDimensions();
  const headlineSize = Math.min(Math.round(width * 0.13), 58);
  const cardWidth = width - GUTTER * 2;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.canvas }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <Text style={[styles.wordmark, { color: colors.text }]}>RUN</Text>
          <View style={[styles.topPill, { borderColor: colors.border }]}>
            <Text style={[styles.topPillText, { color: colors.textMuted }]}>
              Coffee · Matcha · Run clubs
            </Text>
          </View>
        </View>

        <View style={styles.headline}>
          <Text
            style={[
              styles.headlineText,
              { color: colors.text, fontSize: headlineSize, lineHeight: headlineSize * 1.05 },
            ]}>
            Run for
          </Text>
          <Text
            style={[
              styles.headlineText,
              {
                color: colors.textMuted,
                opacity: 0.55,
                fontSize: headlineSize,
                lineHeight: headlineSize * 1.05,
                paddingLeft: width * 0.12,
              },
            ]}>
            your
          </Text>
          <Text
            style={[
              styles.headlineText,
              styles.serifItalic,
              { color: colors.text, fontSize: headlineSize, lineHeight: headlineSize * 1.15 },
            ]}>
            coffee.
          </Text>
          <Text style={[styles.intro, { color: colors.textMuted }]}>
            Every qualifying {REWARD_DISTANCE_KM} km run unlocks a reward at the cafés and spots
            that make your city&apos;s running culture.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.hero, height: cardWidth * 0.62 }]}>
          <View style={styles.cardText}>
            <View style={styles.chipRow}>
              <View style={[styles.chip, { backgroundColor: colors.accent }]}>
                <Text style={[styles.chipText, { color: colors.accentText }]}>
                  {REWARD_DISTANCE_KM} km
                </Text>
              </View>
              <View style={[styles.chip, styles.chipGlass]}>
                <Text style={[styles.chipText, { color: colors.heroText }]}>Any spot</Text>
              </View>
            </View>
            <Text style={[styles.cardTitle, { color: colors.heroText }]}>
              One run.{'\n'}One reward.{'\n'}
              <Text style={styles.serifItalic}>Your call.</Text>
            </Text>
          </View>
          <Image
            source={require('@/assets/images/products/plato-matcha.png')}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
            style={[styles.cardImage, { height: cardWidth * 0.56, width: cardWidth * 0.42 }]}
          />
        </View>

        <View style={styles.steps}>
          {STEPS.map((step, index) => (
            <View key={step.title} style={[styles.stepRow, { borderTopColor: colors.border }]}>
              <Text style={[styles.stepNumber, { color: colors.textMuted }]}>
                {String(index + 1).padStart(2, '0')}
              </Text>
              <View style={styles.stepText}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>{step.title}</Text>
                <Text style={[styles.stepDetail, { color: colors.textMuted }]}>{step.detail}</Text>
              </View>
            </View>
          ))}
        </View>

        {!isSupabaseConfigured && (
          <Notice title="ACCOUNTS NOT SWITCHED ON YET">
            Sign-up and log-in will work once the app&apos;s Supabase connection is configured.
            {/* In development, say exactly what's wrong (never the values themselves). */}
            {__DEV__ && supabaseConfigProblem ? `\n\n${supabaseConfigProblem}` : ''}
          </Notice>
        )}

        <View style={styles.actions}>
          <PrimaryButton label="GET STARTED" onPress={() => router.push('/sign-up')} />
          <SecondaryButton label="LOG IN" onPress={() => router.push('/log-in')} />

          {/* Development only: lets the existing app be tested before Supabase is set up. */}
          {__DEV__ && !isSupabaseConfigured && (
            <Pressable
              accessibilityRole="button"
              onPress={enterDevPreview}
              style={[styles.devButton, { borderColor: colors.textMuted }]}>
              <Text style={[styles.devButtonText, { color: colors.textMuted }]}>
                DEV · Preview the app without an account
              </Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: GUTTER,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
  },
  serifItalic: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
  },
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
  headline: {
    marginTop: Spacing.five,
  },
  headlineText: {
    fontWeight: '400',
    letterSpacing: -1.5,
  },
  intro: {
    fontSize: 16,
    lineHeight: 23,
    marginTop: Spacing.three,
    maxWidth: 330,
  },
  card: {
    flexDirection: 'row',
    borderRadius: 32,
    marginTop: Spacing.four,
    paddingLeft: Spacing.four,
    paddingVertical: Spacing.four,
    overflow: 'hidden',
  },
  cardText: {
    flex: 1,
    justifyContent: 'space-between',
  },
  chipRow: {
    flexDirection: 'row',
    gap: Spacing.two,
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
  cardTitle: {
    fontSize: 26,
    fontWeight: '400',
    letterSpacing: -0.6,
    lineHeight: 30,
  },
  cardImage: {
    alignSelf: 'flex-end',
    marginBottom: -Spacing.four,
  },
  steps: {
    marginTop: Spacing.four,
    marginBottom: Spacing.four,
  },
  stepRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stepNumber: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  stepText: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 17,
    fontWeight: '500',
  },
  stepDetail: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
  },
  actions: {
    gap: Spacing.three,
    marginTop: Spacing.three,
  },
  devButton: {
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  devButtonText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
  },
});
