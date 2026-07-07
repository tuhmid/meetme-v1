import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { ZoomIn, useReducedMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import type { IconName } from './_internal';

export interface RatingStarsProps {
  value: number;
  size?: number;
  /** When provided, stars become tappable and call onPick(1..5). */
  onPick?: (value: number) => void;
  count?: number;
}

/** Row of filled / half / empty stars in `colors.star`; tappable when onPick is set. */
export function RatingStars({ value, size = 18, onPick, count = 5 }: RatingStarsProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const { colors, spacing, motion } = theme;
  // remember the tapped value so the chosen stars fill (and pop) right away
  const [picked, setPicked] = useState(0);
  const display = onPick ? Math.max(value, picked) : value;

  const stars = Array.from({ length: count }, (_, i) => {
    const filled = display >= i + 1;
    const half = !filled && display >= i + 0.5;
    const name: IconName = filled ? 'star' : half ? 'star-half' : 'star-outline';
    const color = filled || half ? colors.star : colors.textMuted;
    const star = <Ionicons name={name} size={size} color={color} />;

    if (onPick) {
      return (
        <Pressable
          key={i}
          onPress={() => { setPicked(i + 1); onPick(i + 1); }}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`Rate ${i + 1} star${i === 0 ? '' : 's'}`}
        >
          {filled && !reduceMotion ? (
            // keyed on the picked value so the chosen stars pop once per pick
            <Animated.View key={`pop-${display}`} entering={ZoomIn.springify().damping(motion.spring.damping)}>
              {star}
            </Animated.View>
          ) : (
            star
          )}
        </Pressable>
      );
    }
    return <View key={i}>{star}</View>;
  });

  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>{stars}</View>;
}

export default RatingStars;
