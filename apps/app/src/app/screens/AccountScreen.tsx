// Account tab — your profile, payment method, ID verification, blocked users,
// and the safety & legal fine print.
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { api, type UserProfile } from '../../api';
import { ThemeToggle, useTheme } from '../../theme';
import { Accordion, Avatar, Badge, Button, Card, SectionLabel } from '../../ui';
import { useApp } from '../AppContext';
import { formatPhone, inputStyle, phoneValid } from '../dealLogic';

export default function AccountScreen() {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const { duration } = theme.motion;
  // staggered section entrance; plain fade when the user prefers reduced motion
  const enterSection = (i: number) =>
    reduceMotion ? FadeIn.duration(duration.base).delay(i * 45) : FadeInDown.duration(duration.base).delay(i * 45);
  const { session, demo, viewAs, logout, bearer, myId, phone } = useApp();

  const [me, setMe] = useState<UserProfile | null>(null);
  const [blocked, setBlocked] = useState<{ id: string; name: string }[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const loadAccount = useCallback(async () => {
    try {
      setErr('');
      const [p, b] = await Promise.all([api.getUserProfile(bearer(), myId()), api.listBlocked(bearer())]);
      setMe(p);
      setBlocked(b.blocked);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
    // bearer/myId are stable helpers; what actually changes their output is below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewAs, session, demo]);

  // fresh data whenever the tab gains focus or the demo "Viewing as" side flips
  useFocusEffect(
    useCallback(() => {
      if (session || demo) { setEditingName(false); void loadAccount(); }
    }, [loadAccount, session, demo])
  );

  const doAction = (fn: () => Promise<void>) =>
    (async () => {
      setBusy(true);
      setErr('');
      try { await fn(); await loadAccount(); } catch (e: any) { setErr(String(e?.message ?? e)); } finally { setBusy(false); }
    })();

  const saveName = () => {
    const n = nameDraft.trim();
    if (!n) return;
    void doAction(async () => {
      await api.updateProfile(bearer(), n);
      setEditingName(false);
    });
  };

  const addCard = () => doAction(async () => { await api.addPaymentMethod(bearer()); });
  const verifyId = () => doAction(async () => { await api.verifyKyc(bearer()); });
  const unblock = (u: { id: string; name: string }) =>
    Alert.alert(`Unblock ${u.name}?`, 'They will be able to start deals and invites with you again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unblock', style: 'destructive', onPress: () => void doAction(async () => { await api.unblock(bearer(), u.id); }) },
    ]);
  const deleteAccount = () =>
    Alert.alert('Delete account', 'Account deletion ships before public launch. For now, contact support to remove your data.');

  const trust = me?.trustScore ?? 0;
  const trustColor = trust >= 70 ? theme.colors.primary : trust >= 40 ? theme.colors.warning : theme.colors.danger;
  const year = me?.memberSince ? new Date(me.memberSince).getFullYear() : null;
  const identityNote = demo
    ? 'Demo mode — playing both sides on this device'
    : phoneValid(phone) ? formatPhone(phone) : 'Signed in with phone';

  const caption = { color: theme.colors.textMuted, fontSize: 12, marginTop: 8 } as const;
  const bullet = { color: theme.colors.textDim, fontSize: 13, lineHeight: 19, marginBottom: 6 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <StatusBar style="dark" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: 90 }} keyboardShouldPersistTaps="handled">
        <Animated.View entering={enterSection(0)}>
          <SectionLabel style={{ marginTop: 6 }}>Account</SectionLabel>
          <Card>
            {!me ? (
              <View style={{ paddingVertical: 18, alignItems: 'center' }}>
                <ActivityIndicator color={theme.colors.primary} />
              </View>
            ) : (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Avatar name={me.name} color={me.avatarColor} size={52} />
                  <View style={{ flex: 1, marginLeft: 14 }}>
                    {editingName ? (
                      <>
                        <TextInput
                          value={nameDraft}
                          onChangeText={setNameDraft}
                          placeholder="Your name"
                          autoFocus
                          style={[inputStyle(theme), { marginBottom: 8 }]}
                        />
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <View style={{ flex: 1 }}><Button label="Save" disabled={!nameDraft.trim()} onPress={saveName} /></View>
                          <View style={{ flex: 1 }}><Button variant="secondary" label="Cancel" onPress={() => setEditingName(false)} /></View>
                        </View>
                      </>
                    ) : (
                      <Pressable
                        onPress={() => { setNameDraft(me.name); setEditingName(true); }}
                        style={{ flexDirection: 'row', alignItems: 'center' }}
                        hitSlop={8}
                      >
                        <Text style={{ fontSize: 18, fontWeight: '800', color: theme.colors.text }} numberOfLines={1}>{me.name}</Text>
                        <Ionicons name="pencil" size={15} color={theme.colors.textMuted} style={{ marginLeft: 7 }} />
                      </Pressable>
                    )}
                    {!editingName && <Text style={{ color: theme.colors.textDim, marginTop: 3, fontSize: 13 }}>{identityNote}</Text>}
                  </View>
                </View>

                <View style={{ height: 10, borderRadius: 5, backgroundColor: theme.colors.surfaceAlt, overflow: 'hidden', marginTop: 16, marginBottom: 4 }}>
                  <View style={{ width: `${Math.max(4, Math.min(100, trust))}%`, height: 10, backgroundColor: trustColor }} />
                </View>
                <Text style={{ color: theme.colors.textDim, fontSize: 12 }}>
                  {trust}/100 · {me.completedDeals} completed deal{me.completedDeals === 1 ? '' : 's'}{year ? ` · Member since ${year}` : ''}
                </Text>
              </>
            )}
          </Card>
          <View style={{ marginTop: 14, alignItems: 'flex-start' }}><ThemeToggle /></View>
          {!!err && <Text style={{ color: theme.colors.danger, marginTop: 8 }}>{err}</Text>}
        </Animated.View>

        <Animated.View entering={enterSection(1)}>
          <SectionLabel style={{ marginTop: 20 }}>Payment method · test mode</SectionLabel>
          <Card>
            {me?.hasCardOnFile ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="card" size={20} color={theme.colors.primary} />
                <Text style={{ flex: 1, marginLeft: 10, color: theme.colors.text, fontWeight: '600' }}>Visa •••• {me.cardLast4 ?? '4242'}</Text>
                <Badge label="On file" tone="success" iconName="checkmark-circle" />
              </View>
            ) : (
              <Button label="Add card" iconName="card" loading={busy} onPress={addCard} />
            )}
            <Text style={caption}>Only ever charged if you no-show. Test mode — a fake Visa is used; no real money moves.</Text>
          </Card>
        </Animated.View>

        <Animated.View entering={enterSection(2)}>
          <SectionLabel style={{ marginTop: 20 }}>ID verification</SectionLabel>
          <Card>
            {me?.idVerified ? (
              <Badge label="ID verified" tone="success" iconName="shield-checkmark" />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="id-card-outline" size={20} color={theme.colors.textDim} />
                <Text style={{ flex: 1, marginLeft: 10, color: theme.colors.textDim }}>Not verified</Text>
                <View style={{ flexShrink: 0 }}>
                  <Button variant="secondary" label="Verify ID (demo)" loading={busy} onPress={verifyId} style={{ paddingHorizontal: 14 }} />
                </View>
              </View>
            )}
            <Text style={caption}>Required for deals over $500.</Text>
          </Card>
        </Animated.View>

        <Animated.View entering={enterSection(3)}>
          <SectionLabel style={{ marginTop: 20 }}>Blocked users</SectionLabel>
          <Card padded={false}>
            {blocked.length === 0 ? (
              <Text style={{ color: theme.colors.textMuted, padding: 14 }}>No one blocked.</Text>
            ) : (
              blocked.map((u, i) => (
                <View
                  key={u.id}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.colors.border }}
                >
                  <Text style={{ flex: 1, color: theme.colors.text }} numberOfLines={1}>{u.name}</Text>
                  <Pressable onPress={() => unblock(u)} hitSlop={8}>
                    <Text style={{ color: theme.colors.danger, fontWeight: '600' }}>Unblock</Text>
                  </Pressable>
                </View>
              ))
            )}
          </Card>
        </Animated.View>

        <Animated.View entering={enterSection(4)}>
          <SectionLabel style={{ marginTop: 20 }}>Safety &amp; legal</SectionLabel>
          <View style={{ gap: 10 }}>
            <Accordion title="Safety tips">
              <Text style={bullet}>• Meet at a public, camera-covered spot — the verified safe spots we suggest (police stations, transit hubs) are best.</Text>
              <Text style={bullet}>• Keep chat, payment, and confirmation in the app. Anyone pushing you to pay outside escrow is a red flag.</Text>
              <Text style={bullet}>• Share your live location during the meetup so you can find each other.</Text>
              <Text style={bullet}>• Tell someone where you're going; bring a friend for high-value deals.</Text>
              <Text style={[bullet, { marginBottom: 0 }]}>• Trust your gut. If anything feels off, tap "Feel unsafe? Leave safely" on the deal screen — it gets you out and reports it in one tap.</Text>
            </Accordion>
            <Accordion title="Prohibited items">
              <Text style={bullet}>Never buy or sell on MeetMe:</Text>
              <Text style={bullet}>• Weapons and ammunition</Text>
              <Text style={bullet}>• Drugs and paraphernalia</Text>
              <Text style={bullet}>• Alcohol and tobacco</Text>
              <Text style={bullet}>• Counterfeit goods</Text>
              <Text style={bullet}>• Stolen property</Text>
              <Text style={bullet}>• Recalled items</Text>
              <Text style={bullet}>• Live animals</Text>
              <Text style={bullet}>• Anything illegal to sell in your state</Text>
              <Text style={[bullet, { marginBottom: 0 }]}>Spot one? Report it from the deal screen — deals for prohibited items get cancelled and accounts reviewed.</Text>
            </Accordion>
            <Accordion title="Terms summary">
              <Text style={bullet}>• MeetMe holds the buyer's payment in escrow; the seller is paid only after both sides confirm the handoff.</Text>
              <Text style={bullet}>• Both sides put up a $5 deposit to show up. Head out and then bail — or never show — and it goes to the person you stood up, not to MeetMe.</Text>
              <Text style={bullet}>• Sellers never pay upfront: a card on file, with a $5 hold placed only at head-out.</Text>
              <Text style={bullet}>• Disputes freeze the funds until both parties agree on an outcome or a specialist decides.</Text>
              <Text style={bullet}>• One account per phone number. US only for now.</Text>
              <Text style={[bullet, { marginBottom: 0 }]}>• Test mode: all money movement is simulated — no real charges.</Text>
            </Accordion>
          </View>
        </Animated.View>

        <Animated.View entering={enterSection(5)}>
          <Pressable onPress={deleteAccount} style={{ marginTop: 24 }} hitSlop={8}>
            <Text style={{ color: theme.colors.textMuted, textAlign: 'center' }}>Delete account</Text>
          </Pressable>

          <Button variant="dangerGhost" label={demo ? 'Exit demo' : 'Log out'} onPress={logout} style={{ marginTop: 14 }} />

          <Text style={{ color: theme.colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 18 }}>
            MeetMe v1 · test mode — no real money
          </Text>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}
