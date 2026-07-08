// Small shared pieces that predate the UI kit — used by the Home and Deal screens.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import type { Role, UserProfile } from '../api';
import { useTheme } from '../theme';
import { Button, type IconName } from '../ui';
import { combineDayHour, dayOptions, dayStartOf, formatMoney, hourOf, STATE_LABEL, TIME_OF_DAY } from './dealLogic';
import type { DemoUsers } from './AppContext';

export const RolePick = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={{ flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1.5, borderColor: active ? theme.colors.primary : theme.colors.border, backgroundColor: active ? theme.colors.successSoft : theme.colors.surface }}>
      <Text style={{ textAlign: 'center', color: active ? theme.colors.primary : theme.colors.textDim, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
};

export function RoleBar({ viewAs, users, onToggle }: { viewAs: Role; users: DemoUsers; onToggle: () => void }) {
  const theme = useTheme();
  const me = viewAs === 'buyer' ? users.buyer : users.seller;
  const other = viewAs === 'buyer' ? users.seller : users.buyer;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: theme.colors.text, borderRadius: 10, padding: 10, marginBottom: 12 }}>
      <Text style={{ color: theme.colors.surface }}>Viewing as <Text style={{ fontWeight: '800' }}>{me.name} ({viewAs})</Text></Text>
      <Pressable
        onPress={() => { void Haptics.selectionAsync().catch(() => {}); onToggle(); }}
        style={{ backgroundColor: theme.colors.primary, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 }}
      >
        <Text style={{ color: theme.colors.onPrimary, fontSize: 12 }}>View as {other.name.split(' ')[0]} ⇄</Text>
      </Pressable>
    </View>
  );
}

// Trust explainer — how escrow protects both sides. Opened from the TrustBanner.
export function TrustModal({ visible, amount, onClose }: { visible: boolean; amount: number; onClose: () => void }) {
  const theme = useTheme();
  const rows: Array<[IconName, string, string]> = [
    ['lock-closed', 'Held in escrow', `Your ${amount ? formatMoney(amount) : 'payment'} is held by MeetMe — never sent to the other person up front.`],
    ['cash-outline', 'Released only on handoff', 'The seller is paid only after you confirm you got the item, using a one-time release code.'],
    ['shield-checkmark', 'No-show protection', 'If the other person never shows, you are fully refunded — and $4 of their $5 deposit is paid to you (MeetMe keeps a $1 recovery fee).'],
    ['card-outline', 'Sellers never pay upfront', 'Sellers just keep a card on file — a $5 hold goes on when they head out, and it is released once the deal completes.'],
    ['arrow-undo', 'Refundable', 'Cancel before the handoff and everything comes back to you.'],
  ];
  return (
    <SpringSheet visible={visible} onClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: 34 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: theme.colors.text, marginBottom: 4 }}>How your money stays safe</Text>
        <Text style={{ color: theme.colors.textDim, marginBottom: 18 }}>MeetMe holds the payment in escrow, so neither side can be scammed.</Text>
        {rows.map(([icon, title, body]) => (
          <View key={title} style={{ flexDirection: 'row', marginBottom: 16 }}>
            <Ionicons name={icon} size={22} color={theme.colors.primary} style={{ marginTop: 2 }} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ fontWeight: '700', color: theme.colors.text }}>{title}</Text>
              <Text style={{ color: theme.colors.textDim }}>{body}</Text>
            </View>
          </View>
        ))}
        <Button label="Got it" onPress={onClose} />
      </ScrollView>
    </SpringSheet>
  );
}

// Counterparty reputation card: trust signals + your shared history with them.
export function ProfileModal({ visible, loading, profile, onClose, onReportBlock }: {
  visible: boolean; loading: boolean; profile: UserProfile | null; onClose: () => void; onReportBlock: () => void;
}) {
  const theme = useTheme();
  const trust = profile?.trustScore ?? 0;
  const trustColor = trust >= 70 ? theme.colors.primary : trust >= 40 ? theme.colors.warning : theme.colors.danger;
  const initial = (profile?.name ?? '?').trim().charAt(0).toUpperCase();
  const year = profile?.memberSince ? new Date(profile.memberSince).getFullYear() : null;

  return (
    <SpringSheet visible={visible} onClose={onClose}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22, paddingTop: 8, paddingBottom: 40 }}>
          {loading || !profile ? (
            // Loading AND failure both land here — never trap the user without an exit.
            // minHeight keeps the sheet from jumping when the spinner swaps to content.
            <View style={{ paddingVertical: 30, alignItems: 'center', minHeight: 240 }}>
              {loading ? (
                <>
                  <ActivityIndicator color={theme.colors.primary} />
                  <Text style={{ color: theme.colors.textMuted, marginTop: 10, marginBottom: 20 }}>Loading profile…</Text>
                </>
              ) : (
                <>
                  <Ionicons name="cloud-offline-outline" size={28} color={theme.colors.textMuted} />
                  <Text style={{ color: theme.colors.textDim, marginTop: 10, marginBottom: 20 }}>Couldn't load this profile — try again in a moment.</Text>
                </>
              )}
              <Button label="Close" variant="secondary" onPress={onClose} />
            </View>
          ) : (
              // fade the profile in once it has loaded
              <Animated.View entering={FadeIn.duration(theme.motion.duration.base)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: profile.avatarColor, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: theme.colors.surface, fontSize: 22, fontWeight: '800' }}>{initial}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={{ fontSize: 20, fontWeight: '800', color: theme.colors.text }}>{profile.name}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                    <Ionicons name={profile.idVerified ? 'shield-checkmark' : 'call'} size={13} color={profile.idVerified ? theme.colors.primary : theme.colors.textMuted} />
                    <Text style={{ color: profile.idVerified ? theme.colors.primary : theme.colors.textMuted, fontSize: 12, marginLeft: 4 }}>
                      {profile.idVerified ? 'ID verified' : 'Phone verified'}{year ? ` · Member since ${year}` : ''}
                    </Text>
                  </View>
                </View>
              </View>

              {profile.blocked && (
                <View style={{ backgroundColor: theme.colors.dangerSoft, borderRadius: 10, padding: 10, marginBottom: 14, flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="ban" size={15} color={theme.colors.danger} />
                  <Text style={{ color: theme.colors.danger, marginLeft: 6, fontWeight: '600' }}>You've blocked this person.</Text>
                </View>
              )}

              {/* trust score */}
              <Text style={{ fontWeight: '700', color: theme.colors.text, marginBottom: 6 }}>Trust score</Text>
              <View style={{ height: 10, borderRadius: 5, backgroundColor: theme.colors.surfaceAlt, overflow: 'hidden', marginBottom: 4 }}>
                <View style={{ width: `${Math.max(4, Math.min(100, trust))}%`, height: 10, backgroundColor: trustColor }} />
              </View>
              <Text style={{ color: theme.colors.textDim, fontSize: 12, marginBottom: 16 }}>
                {trust}/100 · {profile.completedDeals} completed deal{profile.completedDeals === 1 ? '' : 's'} on MeetMe
              </Text>

              {/* shared history */}
              <Text style={{ fontWeight: '700', color: theme.colors.text, marginBottom: 8 }}>Your history together</Text>
              {profile.shared.length === 0 ? (
                <Text style={{ color: theme.colors.textMuted, marginBottom: 16 }}>This is your first deal with {profile.name.split(' ')[0]}.</Text>
              ) : (
                profile.shared.map((d) => (
                  <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.surfaceAlt }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text }}>{d.itemDescription}</Text>
                      <Text style={{ color: theme.colors.textMuted, fontSize: 12 }}>You were {d.youWere} · {formatMoney(d.amountCents)}</Text>
                    </View>
                    <Text style={{ color: d.state === 'RELEASED' ? theme.colors.primary : theme.colors.textDim, fontSize: 12, fontWeight: '600' }}>{STATE_LABEL[d.state] ?? d.state}</Text>
                  </View>
                ))
              )}

              <Pressable onPress={onReportBlock} style={{ marginTop: 18, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name="flag-outline" size={14} color={theme.colors.danger} />
                <Text style={{ color: theme.colors.danger, marginLeft: 6, fontWeight: '600' }}>Report or block</Text>
              </Pressable>
              <View style={{ height: 12 }} />
              <Button label="Close" onPress={onClose} />
              </Animated.View>
          )}
      </ScrollView>
    </SpringSheet>
  );
}

/**
 * Meetup time selector: ASAP, or a day (Today / Tomorrow / weekday, this week) plus a
 * time of day. Values are midnight-anchored so a chip's selection stays highlighted
 * (the old moving "in 1 hour" never re-matched). null = ASAP.
 */
export function MeetupTimePicker({ value, onChange }: { value: number | null; onChange: (t: number | null) => void }) {
  const theme = useTheme();
  const days = useMemo(() => dayOptions(), []); // stable for the life of the picker
  const now = Date.now();
  const buffer = now + 30 * 60_000; // a slot must be at least 30 min out
  const todayStart = days[0].date;
  const isPast = (day: number, hour: number) => day === todayStart && combineDayHour(day, hour) <= buffer;
  const firstFutureHour = (day: number): number | null => TIME_OF_DAY.find((t) => !isPast(day, t.hour))?.hour ?? null;
  // drop Today once all of its slots have passed — you can still meet ASAP or another day
  const dayChips = days.filter((d) => d.date !== todayStart || firstFutureHour(d.date) !== null);

  const selDay = value != null ? dayStartOf(value) : null;
  const selHour = value != null ? hourOf(value) : null;

  const pickDay = (day: number) => {
    const keep = selHour != null && !isPast(day, selHour) ? selHour : (firstFutureHour(day) ?? 18);
    onChange(combineDayHour(day, keep));
  };
  const pickHour = (hour: number) => {
    const day = selDay != null && !isPast(selDay, hour) ? selDay : (dayChips.find((d) => !isPast(d.date, hour))?.date ?? dayChips[0]?.date ?? todayStart);
    onChange(combineDayHour(day, hour));
  };

  const chip = (label: string, active: boolean, onPress: (() => void) | undefined, disabled = false) => (
    <Pressable
      key={label}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: active ? theme.colors.primary : theme.colors.border, backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface, opacity: disabled ? 0.4 : 1 }}
    >
      <Text style={{ color: active ? theme.colors.primary : theme.colors.textDim, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );

  return (
    <View>
      <View style={{ flexDirection: 'row', marginBottom: 12 }}>{chip('ASAP · meet now', value === null, () => onChange(null))}</View>
      <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, marginBottom: 7 }}>OR PICK A DAY</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {dayChips.map((d) => chip(d.label, selDay === d.date, () => pickDay(d.date)))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, opacity: value === null ? 0.45 : 1 }}>
        {TIME_OF_DAY.map((t) => {
          const disabled = isPast(selDay ?? todayStart, t.hour);
          return chip(t.label, value !== null && selHour === t.hour, () => pickHour(t.hour), disabled);
        })}
      </View>
    </View>
  );
}

/**
 * Bottom sheet with a real spring entrance and animated exit, replacing the
 * stock Modal slide. The Modal itself never animates (animationType="none");
 * a shared value drives the sheet's translate and the backdrop's fade, and the
 * Modal only unmounts after the exit finishes.
 */
export function SpringSheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const theme = useTheme();
  const progress = useSharedValue(0);
  const dragY = useSharedValue(0); // live downward drag on the grab handle
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      dragY.value = 0;
      const { damping, stiffness, mass } = theme.motion.spring;
      progress.value = withSpring(1, { damping, stiffness, mass, overshootClamping: true });
    } else if (mounted) {
      progress.value = withTiming(
        0,
        { duration: theme.motion.duration.fast, easing: Easing.bezier(...theme.motion.easing.accelerate) },
        (finished) => { if (finished) runOnJS(setMounted)(false); }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Drag the grab handle down to dismiss — past a threshold (or a fast flick) closes.
  const pan = Gesture.Pan()
    .onUpdate((e) => { dragY.value = Math.max(0, e.translationY); })
    .onEnd((e) => {
      if (e.translationY > 90 || e.velocityY > 800) runOnJS(onClose)();
      else dragY.value = withSpring(0, { damping: 20, stiffness: 220 });
    });

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.45 }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.value) * 620 + dragY.value }] }));

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' }, backdropStyle]}>
            <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
          </Animated.View>
          <Animated.View
            style={[
              { backgroundColor: theme.colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '86%', overflow: 'hidden' },
              sheetStyle,
            ]}
          >
            <GestureDetector gesture={pan}>
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
                <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: theme.colors.border }} />
              </View>
            </GestureDetector>
            {children}
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
