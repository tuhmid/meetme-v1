import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { toneColors, type IconName, type Tone } from './_internal';

export interface BadgeProps {
  label: string;
  tone?: Tone;
  iconName?: IconName;
}

/**
 * A soft-tinted pill: `*Soft` background + matching solid text, with an optional
 * leading icon (e.g. a check on "ID verified" / "Escrow funded").
 */
export function Badge({ label, tone = 'primary', iconName }: BadgeProps) {
  const theme = useTheme();
  const { radius, spacing, type } = theme;
  const { bg, fg } = toneColors(theme, tone);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: spacing.xs + 2,
        backgroundColor: bg,
        borderRadius: radius.pill,
        paddingVertical: 6,
        paddingHorizontal: 11,
      }}
    >
      {iconName ? <Ionicons name={iconName} size={13} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: type.size.xs, fontWeight: type.weight.semibold, letterSpacing: 0.2 }}>
        {label}
      </Text>
    </View>
  );
}

// ── Deal-state → pill mapping ────────────────────────────────────────────────

export type DealState =
  | 'DRAFT'
  | 'AGREED'
  | 'FUNDED'
  | 'ARMED'
  | 'EN_ROUTE'
  | 'AT_MEETUP'
  | 'CONFIRMING'
  | 'RELEASED'
  | 'DISPUTED'
  | 'DISPUTE_RESOLVED'
  | 'REFUNDED'
  | 'EXPIRED_NO_SHOW'
  | 'CANCELLED'
  | (string & {}); // tolerate unknown states without losing autocomplete

function statusFor(state: string): { label: string; tone: Tone } {
  switch (state) {
    case 'RELEASED':
      return { label: 'Released', tone: 'success' };
    case 'FUNDED':
    case 'ARMED':
    case 'EN_ROUTE':
    case 'AT_MEETUP':
    case 'CONFIRMING':
      return { label: 'In escrow', tone: 'info' };
    case 'DISPUTED':
      return { label: 'Disputed', tone: 'danger' };
    case 'DISPUTE_RESOLVED':
      return { label: 'Resolved', tone: 'success' };
    case 'REFUNDED':
      return { label: 'Refunded', tone: 'neutral' };
    case 'EXPIRED_NO_SHOW':
      return { label: 'No-show', tone: 'warning' };
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'neutral' };
    case 'AGREED':
      return { label: 'Agreed', tone: 'neutral' };
    case 'DRAFT':
      return { label: 'Draft', tone: 'neutral' };
    default:
      return { label: 'Draft', tone: 'neutral' };
  }
}

export interface StatusPillProps {
  state: DealState;
}

/** Small status pill that maps a deal-state string to a label + tone. */
export function StatusPill({ state }: StatusPillProps) {
  const theme = useTheme();
  const { radius } = theme;
  const { label, tone } = statusFor(state);
  const { bg, fg } = toneColors(theme, tone);

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: bg,
        borderRadius: radius.pill,
        paddingVertical: 3,
        paddingHorizontal: 9,
      }}
    >
      <Text style={{ color: fg, fontSize: 11, fontWeight: '700', letterSpacing: 0.3 }}>{label}</Text>
    </View>
  );
}

export default Badge;
