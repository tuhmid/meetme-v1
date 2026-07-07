// Small shared pieces that predate the UI kit — used by the Home and Deal screens.
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import type { Role, UserProfile } from '../api';
import { useTheme } from '../theme';
import { Button, type IconName } from '../ui';
import { formatMoney, STATE_LABEL } from './dealLogic';
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
    ['shield-checkmark', 'No-show protection', 'If the other person never shows, you are fully refunded — and their forfeited $5 commitment is paid to you, not to MeetMe.'],
    ['card-outline', 'Sellers never pay upfront', 'Sellers just keep a card on file — a small hold goes on when they head out, and it is released once the deal completes.'],
    ['arrow-undo', 'Refundable', 'Cancel before the handoff and everything comes back to you.'],
  ];
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: theme.colors.overlay }}>
        <View style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 22, paddingBottom: 40 }}>
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
        </View>
      </View>
    </Modal>
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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: theme.colors.overlay }}>
        <View style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 22, paddingBottom: 34, maxHeight: '86%' }}>
          {loading || !profile ? (
            // Loading AND failure both land here — never trap the user without an exit.
            <View style={{ paddingVertical: 30, alignItems: 'center' }}>
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
            <ScrollView keyboardShouldPersistTaps="handled">
              {/* fade the profile in once it has loaded */}
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
                      <Text style={{ color: theme.colors.text }} numberOfLines={1}>{d.itemDescription}</Text>
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
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
