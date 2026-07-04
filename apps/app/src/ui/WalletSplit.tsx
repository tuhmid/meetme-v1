import { Text, View } from 'react-native';
import { useTheme } from '../theme';
import { formatMoney, withAlpha } from './_internal';

export interface WalletSplitProps {
  walletCents: number;
  escrowCents: number;
}

/**
 * Two joined side-by-side segments: "Your wallet" (surface) and "Held in escrow"
 * (filled primary). Shows the balance in each.
 */
export function WalletSplit({ walletCents, escrowCents }: WalletSplitProps) {
  const theme = useTheme();
  const { colors, radius, spacing, type } = theme;

  return (
    <View
      style={{
        flexDirection: 'row',
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
      }}
    >
      <View style={{ flex: 1, backgroundColor: colors.surface, padding: spacing.lg }}>
        <Text
          style={{ color: colors.textMuted, fontSize: type.size.xs, fontWeight: type.weight.semibold, letterSpacing: 0.5, textTransform: 'uppercase' }}
        >
          Your wallet
        </Text>
        <Text style={{ color: colors.text, fontSize: type.size.lg, fontWeight: type.weight.bold, marginTop: spacing.xs }}>
          {formatMoney(walletCents)}
        </Text>
      </View>

      <View style={{ flex: 1, backgroundColor: colors.primary, padding: spacing.lg }}>
        <Text
          style={{ color: withAlpha(colors.onPrimary, 0.75), fontSize: type.size.xs, fontWeight: type.weight.semibold, letterSpacing: 0.5, textTransform: 'uppercase' }}
        >
          Held in escrow
        </Text>
        <Text style={{ color: colors.onPrimary, fontSize: type.size.lg, fontWeight: type.weight.bold, marginTop: spacing.xs }}>
          {formatMoney(escrowCents)}
        </Text>
      </View>
    </View>
  );
}

export default WalletSplit;
