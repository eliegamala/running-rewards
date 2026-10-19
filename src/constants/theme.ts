/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

/** Brand palette shared by the app's screens. */
export const Palette = {
  light: {
    background: '#F6F2C8',
    card: '#FFFDF0',
    hero: '#2F5130',
    heroText: '#F6F2C8',
    heroMuted: 'rgba(246, 242, 200, 0.6)',
    accent: '#DCE85A',
    accentText: '#22381F',
    text: '#22381F',
    textMuted: '#6E7A5A',
    canvas: '#FAF8F0',
    surface: '#EDEADB',
    border: 'rgba(34, 56, 31, 0.12)',
  },
  dark: {
    background: '#121410',
    card: '#1D211A',
    hero: '#2F5130',
    heroText: '#F6F2C8',
    heroMuted: 'rgba(246, 242, 200, 0.6)',
    accent: '#DCE85A',
    accentText: '#1A2A17',
    text: '#F6F2C8',
    textMuted: '#9CA58A',
    canvas: '#121410',
    surface: '#23281F',
    border: 'rgba(246, 242, 200, 0.12)',
  },
} as const;

export type PaletteColors = (typeof Palette)['light' | 'dark'];

/**
 * Strava brand orange, used only on Strava screens. Text on it is near-black: white on
 * #FD5200 is 3.3:1 (below WCAG AA for these label sizes); #111111 is 5.7:1.
 */
export const StravaBrand = {
  orange: '#FD5200',
  onOrange: '#111111',
} as const;
