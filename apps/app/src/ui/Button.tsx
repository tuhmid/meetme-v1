import { ActivityIndicator, Animated, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { usePressAnim, type IconName } from './_internal';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'dangerGhost' | 'success';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  iconName?: IconName;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The one canonical MeetMe button: full-width, 52pt tall, centered label with an
 * optional leading icon. All colors come from theme tokens so it reads correctly
 * in both Polish (green) and Trust (fintech blue).
 */
export function Button({ label, onPress, variant = 'primary', iconName, disabled, loading, style }: ButtonProps) {
  const theme = useTheme();
  const { colors, radius, spacing, type, shadow } = theme;
  const { scale, opacity, pressIn, pressOut } = usePressAnim();

  const isDisabled = !!disabled || !!loading;

  // Per-variant surface + text + border.
  let bg = colors.primary;
  let fg = colors.onPrimary;
  let borderColor: string | undefined;
  let borderWidth = 0;
  let elevated = true; // filled variants carry shadow.card

  switch (variant) {
    case 'secondary':
      bg = colors.surface;
      fg = colors.primary;
      borderColor = colors.primaryBorder;
      borderWidth = 1.5;
      elevated = false;
      break;
    case 'danger':
      bg = colors.danger;
      fg = colors.onPrimary;
      break;
    case 'dangerGhost':
      bg = colors.surface;
      fg = colors.danger;
      borderColor = colors.danger;
      borderWidth = 1.5;
      elevated = false;
      break;
    case 'success':
      bg = colors.success;
      fg = colors.onPrimary;
      break;
    case 'primary':
    default:
      bg = colors.primary;
      fg = colors.onPrimary;
      break;
  }

  // Leading element: explicit icon, or the danger-ghost warning dot.
  let leading: React.ReactNode = null;
  if (!loading) {
    if (iconName) {
      leading = <Ionicons name={iconName} size={18} color={fg} />;
    } else if (variant === 'dangerGhost') {
      leading = <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.danger }} />;
    }
  }

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      onPressIn={isDisabled ? undefined : pressIn}
      onPressOut={isDisabled ? undefined : pressOut}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: !!loading }}
    >
      <Animated.View
        style={[
          {
            width: '100%',
            minHeight: 52,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.sm,
            paddingHorizontal: spacing.lg,
            borderRadius: radius.md,
            backgroundColor: bg,
            borderWidth,
            borderColor,
          },
          elevated ? shadow.card : null,
          { transform: [{ scale }], opacity },
          style,
          isDisabled ? { opacity: 0.5 } : null,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={fg} />
        ) : (
          <>
            {leading}
            <Text
              numberOfLines={1}
              style={{
                color: fg,
                fontSize: type.size.base,
                fontWeight: type.weight.semibold,
                letterSpacing: 0.2,
              }}
            >
              {label}
            </Text>
          </>
        )}
      </Animated.View>
    </Pressable>
  );
}

export default Button;
