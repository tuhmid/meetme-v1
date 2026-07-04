import { Text, View } from 'react-native';
import { useTheme } from '../theme';
import { toneColors, withAlpha, type Tone } from './_internal';

export interface CalloutProps {
  tone?: Tone;
  /** Small uppercase label above the title, e.g. "YOUR TURN". */
  kicker?: string;
  title: string;
  body?: string;
}

/**
 * A highlighted callout card (tinted bg + tinted border) with an optional kicker
 * row (dot + uppercase label), a big title, and body text. Matches the
 * prototype's "YOUR TURN — On your way to…" card.
 */
export function Callout({ tone = 'primary', kicker, title, body }: CalloutProps) {
  const theme = useTheme();
  const { colors, radius, spacing, type } = theme;
  const { bg, fg } = toneColors(theme, tone);
  const borderColor = tone === 'primary' ? colors.primaryBorder : withAlpha(fg, 0.3);

  return (
    <View
      style={{
        backgroundColor: bg,
        borderWidth: 1,
        borderColor,
        borderRadius: radius.lg,
        padding: spacing.lg,
      }}
    >
      {kicker ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, marginBottom: spacing.xs + 2 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: fg }} />
          <Text
            style={{ color: fg, fontSize: type.size.xs, fontWeight: type.weight.bold, letterSpacing: 0.6, textTransform: 'uppercase' }}
          >
            {kicker}
          </Text>
        </View>
      ) : null}

      <Text style={{ color: colors.text, fontSize: type.size.lg, fontWeight: type.weight.bold, letterSpacing: -0.2 }}>
        {title}
      </Text>

      {body ? (
        <Text
          style={{
            color: colors.textDim,
            fontSize: type.size.sm,
            lineHeight: type.size.sm * type.lineHeight.normal,
            marginTop: spacing.xs + 2,
          }}
        >
          {body}
        </Text>
      ) : null}
    </View>
  );
}

export default Callout;
