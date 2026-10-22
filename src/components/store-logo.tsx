import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { Fonts, type PaletteColors } from '@/constants/theme';
import type { Store } from '@/lib/stores';

function monogram(name: string) {
  return name
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

type StoreLogoProps = {
  store: Store;
  size: number;
  colors: PaletteColors;
  /** Square with rounded corners (default) or a circle. */
  shape?: 'rounded' | 'circle';
};

/** The café's logo on a light tile, or its initials until a logo is uploaded. */
export function StoreLogo({ store, size, colors, shape = 'rounded' }: StoreLogoProps) {
  const radius = shape === 'circle' ? size / 2 : Math.round(size * 0.24);
  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: store.logoUrl ? colors.card : colors.hero,
        },
      ]}>
      {store.logoUrl ? (
        <Image
          source={{ uri: store.logoUrl }}
          style={{ width: size * 0.78, height: size * 0.78 }}
          contentFit="contain"
          transition={150}
          accessibilityLabel={`${store.name} logo`}
        />
      ) : (
        <Text
          style={[styles.monogram, { color: colors.heroText, fontSize: Math.round(size * 0.34) }]}
          accessibilityLabel={store.name}>
          {monogram(store.name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  monogram: {
    fontFamily: Fonts.rounded,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
