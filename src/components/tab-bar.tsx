import { usePathname } from 'expo-router';
import { TabList, Tabs, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Palette, type PaletteColors, Spacing } from '@/constants/theme';
import {
  getRewardCredit,
  subscribe as subscribeToReward,
} from '@/lib/reward-credit';
import { getSnapshot, subscribe } from '@/lib/run-tracker';

type TabButtonProps = TabTriggerSlotProps & {
  colors: PaletteColors;
  showDot?: boolean;
  /** Highlights the tab for related routes that have no tab of their own. */
  forceFocused?: boolean;
};

function TabButton({
  children,
  isFocused: isTabFocused,
  colors,
  showDot,
  forceFocused,
  ...props
}: TabButtonProps) {
  const isFocused = isTabFocused || forceFocused;
  return (
    <Pressable {...props} style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
      <View style={[styles.tabPill, isFocused && { backgroundColor: colors.hero }]}>
        {showDot && <View style={[styles.dot, { backgroundColor: colors.accent }]} />}
        <Text style={[styles.tabLabel, { color: isFocused ? colors.heroText : colors.textMuted }]}>
          {children}
        </Text>
      </View>
    </Pressable>
  );
}

export function TabBar() {
  const scheme = useColorScheme();
  const colors = Palette[scheme === 'dark' ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  // Lets the user see a run is still going while they browse other tabs.
  const run = useSyncExternalStore(subscribe, getSnapshot);
  // Nudges the runner towards Rewards while an unlocked reward is waiting to be used.
  const credit = useSyncExternalStore(subscribeToReward, getRewardCredit);
  const pathname = usePathname();

  return (
    <Tabs>
      <TabSlot />
      <TabList asChild>
        {/* Children of a Slot need a flat style object, not an array. */}
        <View
          style={StyleSheet.flatten([
            styles.bar,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              paddingBottom: Math.max(insets.bottom, Spacing.three),
            },
          ])}>
          <TabTrigger name="index" href="/" asChild>
            <TabButton
              colors={colors}
              forceFocused={pathname === '/profile' || pathname === '/strava'}>
              Home
            </TabButton>
          </TabTrigger>
          <TabTrigger name="run" href="/run" asChild>
            <TabButton colors={colors} showDot={run.isActive}>
              Run
            </TabButton>
          </TabTrigger>
          <TabTrigger name="rewards" href="/rewards" asChild>
            <TabButton
              colors={colors}
              showDot={credit.status === 'unlocked'}
              forceFocused={pathname === '/reward-pass'}>
              Rewards
            </TabButton>
          </TabTrigger>
          {/* These screens have no tab of their own; hidden triggers register their routes. */}
          <TabTrigger name="reward-pass" href="/reward-pass" style={styles.hidden} />
          <TabTrigger name="profile" href="/profile" style={styles.hidden} />
          <TabTrigger name="strava" href="/strava" style={styles.hidden} />
        </View>
      </TabList>
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  hidden: {
    display: 'none',
  },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: Spacing.four,
    borderRadius: 999,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  tabLabel: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
