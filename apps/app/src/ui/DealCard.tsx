import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { Card } from './Card';
import { AvatarPair } from './Avatar';
import { formatMoney } from './_internal';

export interface DealCardPeople {
  a: string;
  b: string;
  label?: string;
  aColor?: string;
  bColor?: string;
}

export interface DealCardProps {
  item: string;
  amountCents: number;
  /** Small label under the price (default "ESCROW"). */
  tag?: string;
  /** e.g. "Sat · 2:30 PM · Bryant Park". */
  metaLine?: string;
  people?: DealCardPeople;
  rating?: number;
}

/** The deal-summary card: item + price on top, meta, divider, then a party/rating footer. */
export function DealCard({ item, amountCents, tag = 'ESCROW', metaLine, people, rating }: DealCardProps) {
  const theme = useTheme();
  const { colors, spacing, type } = theme;

  const showFooter = !!people || rating != null;

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: type.size.xl, fontWeight: type.weight.bold, letterSpacing: -0.3 }}>
            {item}
          </Text>
          {metaLine ? (
            <Text style={{ color: colors.textDim, fontSize: type.size.sm, marginTop: spacing.xs }}>{metaLine}</Text>
          ) : null}
        </View>

        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: colors.text, fontSize: type.size.xl, fontWeight: type.weight.bold, letterSpacing: -0.5 }}>
            {formatMoney(amountCents)}
          </Text>
          {tag ? (
            <Text
              style={{
                color: colors.textMuted,
                fontSize: type.size.xs,
                fontWeight: type.weight.semibold,
                letterSpacing: 0.3,
                textTransform: 'uppercase',
                marginTop: 2,
              }}
            >
              {tag}
            </Text>
          ) : null}
        </View>
      </View>

      {showFooter ? (
        <>
          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.md + 2 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              {people ? (
                <>
                  <AvatarPair a={people.a} b={people.b} aColor={people.aColor} bColor={people.bColor} />
                  {people.label ? (
                    <Text style={{ color: colors.textDim, fontSize: type.size.sm }}>{people.label}</Text>
                  ) : null}
                </>
              ) : null}
            </View>

            {rating != null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 }}>
                <Ionicons name="star" size={15} color={colors.star} />
                <Text style={{ color: colors.textDim, fontSize: type.size.sm, fontWeight: type.weight.medium }}>
                  {rating.toFixed(1)}
                </Text>
              </View>
            ) : null}
          </View>
        </>
      ) : null}
    </Card>
  );
}

export default DealCard;
