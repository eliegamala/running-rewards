import { type ReactNode, useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  Vibration,
  View,
} from 'react-native';

import { Fonts, Palette, Spacing } from '@/constants/theme';

const CONFETTI_COLORS = ['#DCE85A', '#F6F2C8', '#7FA548', '#D9BC98', '#FFFDF0'];

// Fixed, index-derived spread so the burst looks random without re-randomising each render.
const CONFETTI = Array.from({ length: 28 }, (_, i) => ({
  left: ((i * 37) % 100) / 100,
  fall: 0.55 + ((i * 53) % 40) / 100,
  drift: ((i * 29) % 60) - 30,
  spin: (i % 2 ? 1 : -1) * (180 + ((i * 47) % 360)),
  size: 6 + (i % 4) * 2,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  round: i % 3 === 0,
}));

function usePalette() {
  const scheme = useColorScheme();
  return Palette[scheme === 'dark' ? 'dark' : 'light'];
}

type CelebrationModalProps = {
  visible: boolean;
  /** Plays confetti and a vibration when this becomes true. */
  celebrate?: boolean;
  onRequestClose: () => void;
  children: ReactNode;
};

/** Shared dark-green pop-up used for reward moments (unlock, redeem). */
export function CelebrationModal({
  visible,
  celebrate = false,
  onRequestClose,
  children,
}: CelebrationModalProps) {
  const colors = usePalette();
  const { width, height } = useWindowDimensions();
  const [fall] = useState(() => new Animated.Value(0));
  const [pop] = useState(() => new Animated.Value(0));
  const isCelebrating = visible && celebrate;

  // Spring the card in on open, and again when it switches to a celebration.
  useEffect(() => {
    if (!visible) return;
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }).start();
  }, [visible, isCelebrating, pop]);

  useEffect(() => {
    if (!isCelebrating) return;
    Vibration.vibrate([0, 250, 150, 250]);
    fall.setValue(0);
    Animated.timing(fall, {
      toValue: 1,
      duration: 2400,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [isCelebrating, fall]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onRequestClose}>
      <View style={styles.backdrop}>
        {isCelebrating && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {CONFETTI.map((piece, index) => (
              <Animated.View
                key={index}
                style={{
                  position: 'absolute',
                  top: -20,
                  left: piece.left * width,
                  width: piece.size,
                  height: piece.round ? piece.size : piece.size * 1.8,
                  borderRadius: piece.round ? piece.size / 2 : 2,
                  backgroundColor: piece.color,
                  opacity: fall.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, 0] }),
                  transform: [
                    {
                      translateY: fall.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, piece.fall * height],
                      }),
                    },
                    {
                      translateX: fall.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, piece.drift],
                      }),
                    },
                    {
                      rotate: fall.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0deg', `${piece.spin}deg`],
                      }),
                    },
                  ],
                }}
              />
            ))}
          </View>
        )}

        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: colors.hero,
              opacity: pop,
              transform: [
                { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
              ],
            },
          ]}>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

/** Lime badge at the top of the pop-up, holding an emoji or glyph. */
export function ModalBadge({ children }: { children: string }) {
  const colors = usePalette();
  return (
    <View style={styles.badgeRing}>
      <View style={[styles.badge, { backgroundColor: colors.accent }]}>
        <Text style={[styles.badgeText, { color: colors.accentText }]}>{children}</Text>
      </View>
    </View>
  );
}

type ModalButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
};

export function ModalButton({ label, onPress, variant = 'primary' }: ModalButtonProps) {
  const colors = usePalette();
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        isPrimary ? styles.primaryButton : styles.secondaryButton,
        isPrimary && { backgroundColor: colors.accent },
        pressed && styles.pressed,
      ]}>
      <Text
        style={
          isPrimary
            ? [styles.primaryButtonText, { color: colors.accentText }]
            : [styles.secondaryButtonText, { color: colors.heroMuted }]
        }>
        {label}
      </Text>
    </Pressable>
  );
}

/** Text styles for pop-up content; pair with Palette `accent` / `heroText` / `heroMuted`. */
export const modalText = StyleSheet.create({
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: Spacing.four,
  },
  title: {
    fontSize: 40,
    fontWeight: '400',
    letterSpacing: -1,
    lineHeight: 44,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  serifItalic: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
  },
  copy: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: Spacing.three,
    maxWidth: 280,
  },
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 20, 10, 0.6)',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    borderRadius: 32,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.three,
    alignItems: 'center',
  },
  badgeRing: {
    width: 124,
    height: 124,
    borderRadius: 62,
    borderWidth: 1,
    borderColor: 'rgba(220, 232, 90, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 46,
    fontWeight: '600',
  },
  primaryButton: {
    alignSelf: 'stretch',
    height: 56,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.four,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  secondaryButton: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
});
