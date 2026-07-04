import { useRef, useState } from 'react';
import { Animated, LayoutAnimation, Platform, Pressable, Text, UIManager, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';

// LayoutAnimation needs an explicit opt-in on Android.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export interface AccordionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

/** A surface row with a title + chevron that expands/collapses its children. */
export function Accordion({ title, children, defaultOpen = false }: AccordionProps) {
  const theme = useTheme();
  const { colors, radius, spacing, type, motion } = theme;
  const [open, setOpen] = useState(defaultOpen);
  const rotate = useRef(new Animated.Value(defaultOpen ? 1 : 0)).current;

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.create(motion.duration.base, 'easeInEaseOut', 'opacity'));
    Animated.timing(rotate, {
      toValue: open ? 0 : 1,
      duration: motion.duration.base,
      useNativeDriver: true,
    }).start();
    setOpen((o) => !o);
  };

  const spin = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
      }}
    >
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: spacing.md + 2,
          paddingHorizontal: spacing.lg,
        }}
      >
        <Text style={{ color: colors.text, fontSize: type.size.base, fontWeight: type.weight.semibold }}>{title}</Text>
        <Animated.View style={{ transform: [{ rotate: spin }] }}>
          <Ionicons name="chevron-down" size={20} color={colors.textDim} />
        </Animated.View>
      </Pressable>

      {open ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, paddingTop: spacing.xs }}>
          {children}
        </View>
      ) : null}
    </View>
  );
}

export default Accordion;
