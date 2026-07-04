import { Animated, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { StatusPill, type DealState } from './Badge';
import { formatMoney, usePressAnim, type IconName } from './_internal';

export interface DealHistoryRowProps {
  iconName?: IconName;
  title: string;
  subtitle?: string;
  amountCents: number;
  state: DealState;
  onPress?: () => void;
  /** Draw a bottom hairline (set false on the last row of a list). Default true. */
  showDivider?: boolean;
}

/**
 * A deal-history list row: rounded icon tile + title/subtitle on the left,
 * amount + StatusPill on the right. Rows are separated by a hairline.
 */
export function DealHistoryRow({
  iconName = 'cube-outline',
  title,
  subtitle,
  amountCents,
  state,
  onPress,
  showDivider = true,
}: DealHistoryRowProps) {
  const theme = useTheme();
  const { colors, radius, spacing, type } = theme;
  const { scale, opacity, pressIn, pressOut } = usePressAnim(0.99, 0.94);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPress ? pressIn : undefined}
      onPressOut={onPress ? pressOut : undefined}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <Animated.View
        style={{
          transform: [{ scale }],
          opacity,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingVertical: spacing.md + 1,
          paddingHorizontal: spacing.lg,
          borderBottomWidth: showDivider ? 1 : 0,
          borderBottomColor: colors.border,
        }}
      >
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: radius.md,
            backgroundColor: colors.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={iconName} size={18} color={colors.textDim} />
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: type.size.sm, fontWeight: type.weight.semibold }}>
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: type.size.xs, marginTop: 1 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        <View style={{ alignItems: 'flex-end', gap: spacing.xs + 2 }}>
          <Text style={{ color: colors.text, fontSize: type.size.sm, fontWeight: type.weight.bold }}>
            {formatMoney(amountCents, true)}
          </Text>
          <StatusPill state={state} />
        </View>
      </Animated.View>
    </Pressable>
  );
}

export default DealHistoryRow;
