import { Pressable, View } from 'react-native';
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
  const { colors, spacing } = theme;

  const stars = Array.from({ length: count }, (_, i) => {
    const filled = value >= i + 1;
    const half = !filled && value >= i + 0.5;
    const name: IconName = filled ? 'star' : half ? 'star-half' : 'star-outline';
    const color = filled || half ? colors.star : colors.textMuted;
    const star = <Ionicons name={name} size={size} color={color} />;

    if (onPick) {
      return (
        <Pressable
          key={i}
          onPress={() => onPick(i + 1)}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`Rate ${i + 1} star${i === 0 ? '' : 's'}`}
        >
          {star}
        </Pressable>
      );
    }
    return <View key={i}>{star}</View>;
  });

  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>{stars}</View>;
}

export default RatingStars;
