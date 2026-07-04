import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';

export interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Apply the default inner padding (spacing.lg). Defaults to true. */
  padded?: boolean;
}

/** Surface container: hairline border + softly-lifted shadow.card, radius lg. */
export function Card({ children, style, padded = true }: CardProps) {
  const theme = useTheme();
  const { colors, radius, spacing, shadow } = theme;
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          padding: padded ? spacing.lg : 0,
        },
        shadow.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export interface SectionLabelProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Uppercase muted section label — e.g. "MEETUP LOCATION" / "DEAL HISTORY". */
export function SectionLabel({ children, style }: SectionLabelProps) {
  const theme = useTheme();
  const { colors, type, spacing } = theme;
  return (
    <View style={[{ marginBottom: spacing.sm }, style]}>
      <Text
        style={{
          color: colors.textMuted,
          fontSize: type.size.xs,
          fontWeight: type.weight.semibold,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
        }}
      >
        {children}
      </Text>
    </View>
  );
}

export default Card;
