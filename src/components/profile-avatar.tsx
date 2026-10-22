import { Image } from 'expo-image';
import { useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Fonts, type PaletteColors } from '@/constants/theme';
import { getProfile, subscribe as subscribeToProfile } from '@/lib/profile';

export function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

type ProfileAvatarProps = {
  size: number;
  colors: PaletteColors;
  children?: React.ReactNode;
};

/**
 * The runner's photo, else their initials, else a person glyph (drawn with Views, so no
 * icon package is needed). Shared by Home and Profile so they always match.
 */
export function ProfileAvatar({ size, colors, children }: ProfileAvatarProps) {
  const profile = useSyncExternalStore(subscribeToProfile, getProfile);
  const initials = getInitials(profile.displayName);
  const circle = { width: size, height: size, borderRadius: size / 2 };

  return (
    <View style={[styles.avatar, circle, { backgroundColor: colors.hero }]}>
      {profile.avatarUrl ? (
        <Image
          source={{ uri: profile.avatarUrl, cacheKey: profile.avatarPath ?? undefined }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          accessibilityIgnoresInvertColors
        />
      ) : initials ? (
        <View style={styles.centered}>
          <Text
            style={[
              styles.initials,
              { color: colors.heroText, fontSize: Math.round(size * 0.37) },
            ]}>
            {initials}
          </Text>
        </View>
      ) : (
        <>
          <View
            style={{
              width: size * 0.32,
              height: size * 0.32,
              borderRadius: size * 0.16,
              marginBottom: size * 0.05,
              backgroundColor: colors.heroText,
            }}
          />
          <View
            style={{
              width: size * 0.6,
              height: size * 0.31,
              borderTopLeftRadius: size * 0.3,
              borderTopRightRadius: size * 0.3,
              marginBottom: -1,
              backgroundColor: colors.heroText,
            }}
          />
        </>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  centered: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontFamily: Fonts.rounded,
    fontWeight: '600',
    letterSpacing: 1,
  },
});
