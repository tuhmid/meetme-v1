import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { withAlpha } from './_internal';

export interface Party {
  label: string;
  status: string;
  color: string;
}

export interface PresenceCardProps {
  live?: boolean;
  you: Party;
  them: Party;
  /** Show the stylized route band with two positioned dots + dashed line + pin. */
  showRoute?: boolean;
}

/** A colored presence dot with a soft same-hue ring. */
function Dot({ color, size = 14 }: { color: string; size?: number }) {
  const ring = Math.round(size * 0.6);
  return (
    <View
      style={{
        width: size + ring,
        height: size + ring,
        borderRadius: (size + ring) / 2,
        backgroundColor: withAlpha(color, 0.16),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

function PartyRow({ party }: { party: Party }) {
  const theme = useTheme();
  const { colors, type, spacing } = theme;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Dot color={party.color} />
      <Text style={{ color: colors.text, fontSize: type.size.sm, fontWeight: type.weight.medium }}>{party.label}</Text>
      <Text style={{ marginLeft: 'auto', color: colors.textMuted, fontSize: type.size.xs }}>{party.status}</Text>
    </View>
  );
}

/** A thin stylized route band: you-dot → dashed line → them-dot → destination pin. */
function RouteBand({ you, them }: { you: Party; them: Party }) {
  const theme = useTheme();
  const { colors, radius, spacing } = theme;
  return (
    <View
      style={{
        height: 44,
        borderRadius: radius.md,
        backgroundColor: colors.surfaceAlt,
        marginTop: spacing.xs,
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {/* dashed track */}
      <View
        style={{
          position: 'absolute',
          left: '12%',
          right: '10%',
          top: 22,
          height: 0,
          borderTopWidth: 2,
          borderStyle: 'dashed',
          borderColor: colors.border,
        }}
      />
      {/* you */}
      <View style={{ position: 'absolute', left: '12%', top: 15 }}>
        <Dot color={you.color} size={12} />
      </View>
      {/* them */}
      <View style={{ position: 'absolute', left: '52%', top: 15 }}>
        <Dot color={them.color} size={12} />
      </View>
      {/* destination pin */}
      <View style={{ position: 'absolute', right: '8%', top: 12 }}>
        <Ionicons name="location" size={20} color={colors.primary} />
      </View>
    </View>
  );
}

/**
 * Buyer/seller presence card with an optional LIVE header and an optional route
 * band. Each party shows a colored dot, a label, and a right-aligned status.
 */
export function PresenceCard({ live, you, them, showRoute }: PresenceCardProps) {
  const theme = useTheme();
  const { colors, radius, spacing, type, shadow } = theme;

  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          padding: spacing.lg,
          gap: spacing.md,
        },
        shadow.card,
      ]}
    >
      {live ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success }} />
          <Text
            style={{
              color: colors.success,
              fontSize: type.size.xs,
              fontWeight: type.weight.bold,
              letterSpacing: 0.6,
            }}
          >
            LIVE
          </Text>
        </View>
      ) : null}

      <PartyRow party={you} />
      <PartyRow party={them} />

      {showRoute ? <RouteBand you={you} them={them} /> : null}
    </View>
  );
}

export default PresenceCard;
