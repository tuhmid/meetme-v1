// Deals list + invites + the start-a-deal form.
import { useCallback } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, useReducedMotion } from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import { Swipeable } from 'react-native-gesture-handler';
import { useTheme } from '../../theme';
import { Button, Callout, Card, DealHistoryRow, SectionLabel } from '../../ui';
import { useApp } from '../AppContext';
import { RoleBar, RolePick } from '../components';
import { buyerFeeCents, centsFromInput, depositForAmount, feeForAmount, formatMoney, formatPhone, inputStyle, sellerFeeCents } from '../dealLogic';

export default function HomeScreen() {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const { duration } = theme.motion;
  // staggered section entrance; plain fade when the user prefers reduced motion
  const enterSection = (i: number) =>
    reduceMotion ? FadeIn.duration(duration.base).delay(i * 45) : FadeInDown.duration(duration.base).delay(i * 45);
  const {
    session, demo, viewAs, setViewAs,
    banner, setBanner, err,
    deals, invites, loadHome, pollHome, openDeal, deleteDraft,
    acceptInvite, declineInvite,
    item, setItem, amountCents, setAmountCents, cpPhone, setCpPhone,
    inviteRole, setInviteRole, dealValid, inviteValid, newDeal, inviteSomeone,
  } = useApp();

  // initial load — was gated on `phase === 'home'`
  useFocusEffect(
    useCallback(() => {
      if (session || demo) loadHome();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewAs, session, demo])
  );

  // keep the home lists (deals + incoming invites) fresh without a manual reload
  useFocusEffect(
    useCallback(() => {
      if (!(session || demo)) return;
      const t = setInterval(pollHome, 4000);
      return () => clearInterval(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session, demo, viewAs])
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: 90 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {session ? (
            <View style={{ backgroundColor: theme.colors.text, borderRadius: 10, padding: 10, marginBottom: 12 }}>
              <Text style={{ color: theme.colors.surface }}>Signed in as <Text style={{ fontWeight: '800' }}>{session.name}</Text></Text>
            </View>
          ) : (
            demo && <RoleBar viewAs={viewAs} users={demo} onToggle={() => setViewAs((r) => (r === 'buyer' ? 'seller' : 'buyer'))} />
          )}

          {!!banner && (
            <Animated.View
              entering={reduceMotion ? FadeIn.duration(duration.base) : FadeInDown.duration(duration.base)}
              exiting={FadeOut.duration(duration.fast)}
              style={{ marginBottom: 10 }}
            >
              <Pressable onPress={() => setBanner('')}>
                <Callout tone="primary" title={banner} />
              </Pressable>
            </Animated.View>
          )}
          {!!err && <Text style={{ color: theme.colors.danger, marginVertical: 8 }}>{err}</Text>}

          {session && invites.length > 0 && (
            <>
              <Animated.View entering={enterSection(0)}>
                <SectionLabel style={{ marginTop: 6 }}>Invites for you</SectionLabel>
              </Animated.View>
              {invites.map((iv, i) => {
                // Show the invitee THEIR fee share up front — the first thing they see before accepting.
                const total = feeForAmount(iv.amountCents);
                const myFee = iv.yourRole === 'seller' ? sellerFeeCents(total, depositForAmount(iv.amountCents)) : buyerFeeCents(total, depositForAmount(iv.amountCents));
                return (
                  // keyed by token so a freshly arrived invite animates in on its own
                  <Animated.View key={iv.token} entering={enterSection(i)}>
                    <Card style={{ marginBottom: 10 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <Text numberOfLines={1} style={{ flex: 1, fontWeight: '700', fontSize: 16, color: theme.colors.text, marginRight: 10 }}>{iv.itemDescription}</Text>
                        <Text style={{ fontWeight: '700', fontSize: 16, color: theme.colors.text }}>{formatMoney(iv.amountCents)}</Text>
                      </View>
                      <Text style={{ color: theme.colors.textDim, marginTop: 3, fontSize: 13 }}>from {iv.inviterName} · you'd be the {iv.yourRole}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 8, backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.sm, paddingVertical: 7, paddingHorizontal: 10 }}>
                        <Text style={{ color: theme.colors.textDim, fontSize: 13 }}>Your MeetMe fee </Text>
                        <Text style={{ color: theme.colors.primary, fontSize: 15, fontWeight: '800' }}>{formatMoney(myFee)}</Text>
                        <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginLeft: 6 }}>· only if the deal completes</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                        <View style={{ flex: 1 }}><Button label="Accept" onPress={() => acceptInvite(iv.token)} /></View>
                        <View style={{ flex: 1 }}><Button variant="secondary" label="Decline" onPress={() => declineInvite(iv.token)} /></View>
                      </View>
                    </Card>
                  </Animated.View>
                );
              })}
            </>
          )}

          <Animated.View entering={enterSection(1)}>
          <SectionLabel style={{ marginTop: 14 }}>Start a deal</SectionLabel>
          <Card>
            <TextInput value={item} onChangeText={setItem} placeholder="Item (e.g. iPhone 12, 128GB)" style={inputStyle(theme)} />
            <TextInput value={amountCents ? formatMoney(amountCents) : ''} onChangeText={(t) => setAmountCents(centsFromInput(t))} placeholder="$0.00" placeholderTextColor={theme.colors.textMuted} keyboardType="number-pad" style={inputStyle(theme)} />
            {amountCents > 0 && (() => {
              // The fee is split — show only the CREATOR'S share (buyer unless they're inviting as the seller).
              // The buyer's share scales with the deposit, so mirror the server's deposit for this price.
              const total = feeForAmount(amountCents);
              const deposit = depositForAmount(amountCents);
              const myFee = (!!session && inviteRole === 'seller') ? sellerFeeCents(total, deposit) : buyerFeeCents(total, deposit);
              return (
                <Animated.View entering={FadeIn.duration(200)} style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: -2, marginBottom: 12, paddingHorizontal: 2 }}>
                  <Text style={{ color: theme.colors.textDim, fontSize: 13 }}>Your MeetMe fee </Text>
                  <Animated.Text key={myFee} entering={FadeIn.duration(220)} exiting={FadeOut.duration(140)} style={{ color: theme.colors.primary, fontSize: 15, fontWeight: '800' }}>
                    {formatMoney(myFee)}
                  </Animated.Text>
                  <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginLeft: 6 }}>· charged only when the deal completes</Text>
                </Animated.View>
              );
            })()}
            {session ? (
              <>
                <TextInput value={cpPhone} onChangeText={(t) => setCpPhone(formatPhone(t))} placeholder="555-123-4567" keyboardType="phone-pad" maxLength={12} style={inputStyle(theme)} />
                <View style={{ flexDirection: 'row', marginBottom: 12 }}>
                  <RolePick label="I'm buying" active={inviteRole === 'buyer'} onPress={() => setInviteRole('buyer')} />
                  <View style={{ width: 8 }} />
                  <RolePick label="I'm selling" active={inviteRole === 'seller'} onPress={() => setInviteRole('seller')} />
                </View>
                <Button label={inviteValid() ? `Send invite (${formatMoney(amountCents)})` : 'Send invite'} disabled={!inviteValid()} onPress={inviteSomeone} />
              </>
            ) : (
              <Button label={dealValid() ? `Create deal (${formatMoney(amountCents)})` : 'Create deal'} disabled={!dealValid()} onPress={newDeal} style={{ marginTop: 4 }} />
            )}
          </Card>
          </Animated.View>

          <Animated.View entering={enterSection(2)}>
          <SectionLabel style={{ marginTop: 20 }}>Your deals</SectionLabel>
          {deals.length === 0 && invites.length === 0 && (
            <Callout kicker="Get started" title="No deals yet" body="Invite someone above — money is held in escrow and only released when you both confirm the handoff." />
          )}
          {deals.length === 0 && invites.length > 0 && <Text style={{ color: theme.colors.textMuted }}>No deals yet.</Text>}
          {deals.length > 0 && (
            <Card padded={false} style={{ overflow: 'hidden' }}>
              {deals.map((d, i) => {
                const row = (
                  <View style={{ backgroundColor: theme.colors.surface }}>
                    <DealHistoryRow
                      title={d.itemDescription}
                      amountCents={d.amountCents}
                      state={d.state}
                      onPress={() => openDeal(d.id)}
                      showDivider={i < deals.length - 1}
                    />
                  </View>
                );
                if (d.state !== 'DRAFT') return <View key={d.id}>{row}</View>;
                return (
                  <Swipeable
                    key={d.id}
                    renderRightActions={() => (
                      <Pressable onPress={() => deleteDraft(d.id)} style={{ backgroundColor: theme.colors.danger, justifyContent: 'center', paddingHorizontal: 22 }}>
                        <Text style={{ color: theme.colors.surface, fontWeight: '700' }}>Delete</Text>
                      </Pressable>
                    )}
                  >
                    {row}
                  </Swipeable>
                );
              })}
            </Card>
          )}
          {session && <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginTop: 10 }}>Tip: swipe a draft deal left to delete it.</Text>}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
