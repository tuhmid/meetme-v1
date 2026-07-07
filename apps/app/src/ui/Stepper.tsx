import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { Easing, FadeIn, ZoomIn, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';

export interface StepperProps {
  steps: string[];
  /** Index of the active (current) step. */
  current: number;
}

const NODE = 26;

/** Connector segment whose primary fill sweeps in when its side of the gap is reached. */
function Connector({ reached, hidden }: { reached: boolean; hidden: boolean }) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const { colors, motion } = theme;
  const progress = useSharedValue(reached ? 1 : 0);

  useEffect(() => {
    const target = reached ? 1 : 0;
    progress.value = reduceMotion
      ? target
      : withTiming(target, { duration: motion.duration.slow, easing: Easing.bezier(...motion.easing.standard) });
  }, [reached, reduceMotion, progress, motion]);

  const fill = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` as `${number}%` }));

  return (
    <View style={{ flex: 1, height: 2, backgroundColor: hidden ? 'transparent' : colors.border, overflow: 'hidden' }}>
      {!hidden && <Animated.View style={[{ height: 2, backgroundColor: colors.primary }, fill]} />}
    </View>
  );
}

/**
 * Horizontal progress stepper: completed = filled primary + check, current =
 * primary ring (hollow), upcoming = hollow border circle. The connector between
 * nodes is primary up to `current`, border after.
 */
export function Stepper({ steps, current }: StepperProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const { colors, type, spacing, motion } = theme;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      {steps.map((label, i) => {
        const completed = i < current;
        const active = i === current;

        // A gap (to the left of node i) is "reached" when its right node <= current.
        const leftReached = i <= current;
        const rightReached = i < current;

        const node = (
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
        );

        return (
          <View key={`${label}-${i}`} style={{ flex: 1, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
              <Connector reached={leftReached} hidden={i === 0} />

              {active ? (
                // keyed on `current` so the ring pops once whenever the step advances
                <Animated.View
                  key={`node-${current}`}
                  entering={reduceMotion
                    ? FadeIn.duration(motion.duration.base)
                    : ZoomIn.springify().damping(motion.spring.damping)}
                >
                  {node}
                </Animated.View>
              ) : (
                node
              )}

              <Connector reached={rightReached} hidden={i === steps.length - 1} />
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
