import { Animated, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { usePressAnim } from './_internal';

export interface MeetupFieldProps {
  /** The currently selected spot name, if any. */
  selected?: string;
  onPressSelected?: () => void;
  onSearch?: () => void;
  /** The selected spot is a custom (unverified) location. */
  custom?: boolean;
}

/**
 * Meetup location picker: an optional highlighted "selected spot" row (primary
 * border, or warning-tinted + "not verified" when custom) plus a search row.
 */
export function MeetupField({ selected, onPressSelected, onSearch, custom }: MeetupFieldProps) {
  const theme = useTheme();
  const { colors, radius, spacing, type } = theme;
  const selectedAnim = usePressAnim();
  const searchAnim = usePressAnim();

  const accent = custom ? colors.warning : colors.primary;

  return (
    <View style={{ gap: spacing.sm + 2 }}>
      {selected ? (
        <Pressable
          onPress={onPressSelected}
          onPressIn={selectedAnim.pressIn}
          onPressOut={selectedAnim.pressOut}
          accessibilityRole="button"
        >
          <Animated.View
            style={{
              transform: [{ scale: selectedAnim.scale }],
              opacity: selectedAnim.opacity,
              backgroundColor: custom ? colors.warningSoft : colors.surface,
              borderWidth: 1.5,
              borderColor: accent,
              borderRadius: radius.md,
              paddingHorizontal: spacing.md + 2,
              paddingVertical: spacing.md,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 }}>
              <Ionicons name="location" size={18} color={accent} />
              <Text
                numberOfLines={1}
                style={{ flex: 1, color: colors.text, fontSize: type.size.base, fontWeight: type.weight.medium }}
              >
                {selected}
              </Text>
              <Text style={{ color: colors.primary, fontSize: type.size.sm, fontWeight: type.weight.semibold }}>
                Change
              </Text>
            </View>
            {custom ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, marginTop: spacing.sm }}>
                <Ionicons name="alert-circle" size={13} color={colors.warning} />
                <Text style={{ color: colors.warning, fontSize: type.size.xs, fontWeight: type.weight.medium }}>
                  Custom spot — not verified
                </Text>
              </View>
            ) : null}
          </Animated.View>
        </Pressable>
      ) : null}

      <Pressable
        onPress={onSearch}
        onPressIn={searchAnim.pressIn}
        onPressOut={searchAnim.pressOut}
        accessibilityRole="search"
      >
        <Animated.View
          style={{
            transform: [{ scale: searchAnim.scale }],
            opacity: searchAnim.opacity,
            minHeight: 52,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm + 2,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md + 2,
          }}
        >
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <Text style={{ color: colors.textMuted, fontSize: type.size.base }}>Search other safe public spots…</Text>
        </Animated.View>
      </Pressable>
    </View>
  );
}

export default MeetupField;
