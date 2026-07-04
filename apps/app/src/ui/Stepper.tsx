import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';

export interface StepperProps {
  steps: string[];
  /** Index of the active (current) step. */
  current: number;
}

const NODE = 26;

/**
 * Horizontal progress stepper: completed = filled primary + check, current =
 * primary ring (hollow), upcoming = hollow border circle. The connector between
 * nodes is primary up to `current`, border after.
 */
export function Stepper({ steps, current }: StepperProps) {
  const theme = useTheme();
  const { colors, type, spacing } = theme;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      {steps.map((label, i) => {
        const completed = i < current;
        const active = i === current;

        // A gap (to the left of node i) is "reached" when its right node <= current.
        const leftReached = i <= current;
        const rightReached = i < current;

        return (
          <View key={`${label}-${i}`} style={{ flex: 1, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
              {/* left connector */}
              <View
                style={{
                  flex: 1,
                  height: 2,
                  backgroundColor: i === 0 ? 'transparent' : leftReached ? colors.primary : colors.border,
                }}
              />

              {/* node */}
              <View
                style={{
                  width: NODE,
                  height: NODE,
                  borderRadius: NODE / 2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: completed ? colors.primary : colors.surface,
                  borderWidth: active ? 3 : completed ? 0 : 1.5,
                  borderColor: active ? colors.primary : colors.border,
                }}
              >
                {completed ? (
                  <Ionicons name="checkmark" size={15} color={colors.onPrimary} />
                ) : active ? (
                  <View
                    style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }}
                  />
                ) : null}
              </View>

              {/* right connector */}
              <View
                style={{
                  flex: 1,
                  height: 2,
                  backgroundColor: i === steps.length - 1 ? 'transparent' : rightReached ? colors.primary : colors.border,
                }}
              />
            </View>

            <Text
              numberOfLines={1}
              style={{
                marginTop: spacing.xs + 2,
                fontSize: type.size.xs,
                color: active ? colors.text : colors.textDim,
                fontWeight: active ? type.weight.bold : type.weight.regular,
              }}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default Stepper;
