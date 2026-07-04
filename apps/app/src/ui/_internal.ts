// Internal shared helpers for the MeetMe UI kit.
// NOT exported from the barrel (index.ts) — these are implementation details
// used across the presentational components. Everything here is theme-driven or
// pure; no business logic, no network.
import { useRef, type ComponentProps } from 'react';
import { Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Theme } from '../theme/types';

/** Strongly-typed Ionicons glyph name (e.g. 'shield-checkmark'). */
export type IconName = ComponentProps<typeof Ionicons>['name'];

/** Semantic tint used by badges / status pills / callouts. */
export type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** Resolve a {bg, fg} pair for a tone from theme tokens (soft bg + solid text). */
export function toneColors(theme: Theme, tone: Tone): { bg: string; fg: string } {
  const c = theme.colors;
  switch (tone) {
    case 'success':
      return { bg: c.successSoft, fg: c.success };
    case 'warning':
      return { bg: c.warningSoft, fg: c.warning };
    case 'danger':
      return { bg: c.dangerSoft, fg: c.danger };
    case 'info':
      // no `infoSoft` token exists — derive a soft wash from the info hue.
      return { bg: withAlpha(c.info, 0.12), fg: c.info };
    case 'neutral':
      return { bg: c.surfaceAlt, fg: c.textDim };
    case 'primary':
    default:
      return { bg: c.primarySoft, fg: c.primary };
  }
}

/** Convert a #rgb / #rrggbb hex to an rgba() string at the given alpha. */
export function withAlpha(hex: string, alpha: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Format integer cents as USD. `compact` drops `.00` for whole-dollar amounts. */
export function formatMoney(cents: number, compact = false): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = compact && rem === 0 ? '' : '.' + String(rem).padStart(2, '0');
  return `${sign}$${grouped}${frac}`;
}

/**
 * Press feedback with React Native's CORE Animated (no reanimated/moti).
 * Returns animated scale + opacity values and press handlers to wire onto a
 * Pressable; spread `{ transform: [{ scale }], opacity }` onto an Animated.View.
 */
export function usePressAnim(scaleTo = 0.97, opacityTo = 0.92) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const pressIn = () => {
    Animated.parallel([
      Animated.spring(scale, { toValue: scaleTo, useNativeDriver: true, speed: 40, bounciness: 0 }),
      Animated.timing(opacity, { toValue: opacityTo, duration: 90, useNativeDriver: true }),
    ]).start();
  };
  const pressOut = () => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 36, bounciness: 6 }),
      Animated.timing(opacity, { toValue: 1, duration: 140, useNativeDriver: true }),
    ]).start();
  };

  return { scale, opacity, pressIn, pressOut };
}
