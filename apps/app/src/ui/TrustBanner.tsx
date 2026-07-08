import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { formatMoney } from './_internal';

export interface TrustBannerProps {
  amountCents: number;
  released?: boolean;
  title?: string;
  subtitle?: string;
  tappable?: boolean; // shows a trailing chevron cue when the card opens a details sheet
}

/**
 * The emotional center of the money screen: a clean tinted card with a shield,
 * a bold title, and a subtitle where the amount is emphasized. Uses only base
 * tokens (successSoft wash + primary/success accents) so it works in both themes.
 */
export function TrustBanner({ amountCents, released, title, subtitle, tappable }: TrustBannerProps) {
  const theme = useTheme();
  const { colors, radius, spacing, type } = theme;

  const amount = formatMoney(amountCents);
  const accent = released ? colors.success : colors.primary;
  const heading = title ?? (released ? 'Funds released' : 'Funds held in escrow');
  const iconName = released ? 'checkmark-done-circle' : 'shield-checkmark';

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.md + 2,
        backgroundColor: colors.successSoft,
        borderWidth: 1,
        borderColor: colors.primaryBorder,
        borderRadius: radius.lg,
        padding: spacing.lg,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.md,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.primaryBorder,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={iconName} size={22} color={accent} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: type.size.base, fontWeight: type.weight.bold }}>{heading}</Text>
        <Text
          style={{
            color: colors.textDim,
            fontSize: type.size.sm,
            lineHeight: type.size.sm * type.lineHeight.normal,
            marginTop: 3,
          }}
        >
          {subtitle ? (
            subtitle
          ) : released ? (
            <>
              <Text style={{ color: accent, fontWeight: type.weight.bold }}>{amount}</Text> has been sent to the seller.
            </>
          ) : (
            <>
              <Text style={{ color: accent, fontWeight: type.weight.bold }}>{amount}</Text> is secured until you both
              confirm the handoff.
            </>
          )}
        </Text>
        {tappable && (
          <Text style={{ color: accent, fontSize: type.size.xs, fontWeight: type.weight.semibold, marginTop: 6 }}>
            See how you're protected
          </Text>
        )}
      </View>

      {tappable && <Ionicons name="chevron-forward" size={18} color={accent} style={{ alignSelf: 'center' }} />}
    </View>
  );
}

export default TrustBanner;
