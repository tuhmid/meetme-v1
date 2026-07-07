// One deal from draft to done: escrow status, actions, meetup, chat, disputes.
import { useCallback } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn, useReducedMotion } from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { Role } from '../../api';
import { supabase } from '../../supabase';
import { ThemeToggle, useTheme } from '../../theme';
import { Badge, Button, Callout, Card, DealCard, MeetupField, PresenceCard, RatingStars, SectionLabel, Stepper, TrustBanner } from '../../ui';
import { useApp } from '../AppContext';
import { ProfileModal, RoleBar, RolePick, TrustModal } from '../components';
import { ESCROW_STATES, formatMoney, iconFor, inputStyle, labelFor, nextActions, outcomeFor, presenceStatus, STEP_INDEX, turnGuidance } from '../dealLogic';

export default function DealScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const reduceMotion = useReducedMotion();
  const { duration, spring } = theme.motion;
  // staggered section entrance; plain fade when the user prefers reduced motion
  const enterSection = (i: number) =>
    reduceMotion ? FadeIn.duration(duration.base).delay(i * 45) : FadeInDown.duration(duration.base).delay(i * 45);
  const crossfade = FadeIn.duration(duration.base);
  const {
    session, demo, viewAs, setViewAs, logout,
    banner, setBanner, err, busy,
    dealId, deal, transfers, code, setCode, geo, names, rep, mapUrl,
    messages, msgInput, setMsgInput, statement, setStatement,
    showTrust, setShowTrust, profile, profileOpen, setProfileOpen, profileLoading,
    meetupOpen, setMeetupOpen, comingFrom, setComingFrom, customSpot, setCustomSpot, suggestions, meetupMsg,
    myId, myRole, refresh, pullDeal, loadMessages, bearer,
    act, rate, sendMessage, cancelDeal, leaveSafely, openDispute, reportOrBlock, theirName,
    openProfile, openMeetup, shareLocation, propose, resolveDispute, submitStatement,
    shareFromAddress, shareFromCurrentLocation, chooseMeetup, useCustomSpot,
  } = useApp();

  // initial pull — was gated on `phase === 'deal'`
  useFocusEffect(
    useCallback(() => {
      if (dealId) refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dealId, viewAs, session])
  );

  // live updates: Realtime in real-auth mode (RLS delivers to the party); polling in demo mode
  useFocusEffect(
    useCallback(() => {
      if (!dealId) return;
      if (session) {
        const pull = () => pullDeal(session.accessToken, dealId).catch(() => {});
        const pullMsgs = () => loadMessages(session.accessToken, dealId);
        pullMsgs();
        const ch = supabase
          .channel(`deal:${dealId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'deals', filter: `id=eq.${dealId}` }, pull)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'transfers', filter: `deal_id=eq.${dealId}` }, pull)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `deal_id=eq.${dealId}` }, pullMsgs)
          .subscribe();
        return () => { supabase.removeChannel(ch); };
      }
      loadMessages(bearer(), dealId);
      const t = setInterval(() => { pullDeal(bearer(), dealId).catch(() => {}); loadMessages(bearer(), dealId); }, 2500);
      return () => clearInterval(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dealId, viewAs, session])
  );

  // don't let a deal banner linger on Home — was the `phase !== 'deal'` effect
  useFocusEffect(
    useCallback(() => {
      return () => setBanner('');
    }, [setBanner])
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: 34 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {session ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: theme.colors.text, borderRadius: 10, padding: 10, marginBottom: 12 }}>
              <Text style={{ color: theme.colors.surface }}>Signed in as <Text style={{ fontWeight: '800' }}>{session.name}</Text></Text>
              <Pressable onPress={logout}><Text style={{ color: theme.colors.danger, fontSize: 12 }}>Log out</Text></Pressable>
            </View>
          ) : (
            demo && <RoleBar viewAs={viewAs} users={demo} onToggle={() => setViewAs((r) => (r === 'buyer' ? 'seller' : 'buyer'))} />
          )}

          <View style={{ marginBottom: 12, alignItems: 'flex-start' }}><ThemeToggle /></View>
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

          {deal && (() => {
            const role = myRole(deal);
            const other: Role = role === 'buyer' ? 'seller' : 'buyer';
            const oName = other === 'buyer' ? names.buyer : names.seller;
            const oFirst = oName.split(' ')[0];
            const oTrust = other === 'buyer' ? rep.buyerTrust : rep.sellerTrust;
            const oDeals = other === 'buyer' ? rep.buyerDeals : rep.sellerDeals;
            const meName = role === 'buyer' ? names.buyer : names.seller;
            const released = deal.state === 'RELEASED' || deal.state === 'DISPUTE_RESOLVED';
            const actions = nextActions(deal, role);
            const canSetSpot = ['DRAFT', 'AGREED', 'ARMED'].includes(deal.state);
            const stepIndex = STEP_INDEX[deal.state];
            const guidance = turnGuidance(deal, role, oFirst, session ? null : `(Demo: tap "View as ${oFirst}" above to act as them.)`);
            const outcome = outcomeFor(deal, role, oFirst);
            const hideTrustBanner = ['REFUNDED', 'CANCELLED', 'EXPIRED_NO_SHOW'].includes(deal.state);
            const cancelLabel =
              deal.state === 'DRAFT' && role === 'seller' ? 'Decline this deal'
              : deal.state === 'DRAFT' || deal.state === 'AGREED' ? 'Cancel deal'
              : deal.state === 'ARMED' ? 'Cancel deal — full refund'
              : `Back out — forfeit ${formatMoney(deal.commitmentCents)}`;
            return (
              <>
            <Pressable onPress={() => navigation.goBack()}><Text style={{ color: theme.colors.primary, marginBottom: 10 }}>← My deals</Text></Pressable>

            <Animated.View entering={enterSection(0)}>
              <DealCard
                item={deal.itemDescription}
                amountCents={deal.amountCents}
                tag={deal.state === 'RELEASED' ? 'RELEASED' : 'ESCROW'}
                metaLine={deal.meetupName ?? 'No meetup spot yet'}
                people={{ a: meName, b: oName, label: `You & ${oFirst}`, aColor: theme.colors[role], bColor: theme.colors[other] }}
                // no star rating here: trustScore isn't a star average — the honest
                // "trust N/100 · N deals" line below covers reputation until we
                // aggregate real per-user star ratings.
              />
            </Animated.View>

            <Animated.View entering={enterSection(1)}>
              <Pressable onPress={openProfile} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 14 }} hitSlop={8}>
                <Ionicons name="star" size={14} color={theme.colors.star} />
                <Text style={{ color: theme.colors.textDim, marginLeft: 5, flex: 1 }}>{oName} · trust {oTrust ?? '—'}/100 · {oDeals} deal{oDeals === 1 ? '' : 's'}</Text>
                <Ionicons name="chevron-forward" size={14} color={theme.colors.textMuted} />
              </Pressable>
            </Animated.View>

            {stepIndex !== undefined && (
              <Animated.View entering={enterSection(2)} style={{ marginBottom: 14 }}>
                <Stepper steps={['Agree', 'Fund', 'Meet', 'Done']} current={stepIndex} />
              </Animated.View>
            )}

            {!hideTrustBanner && (
              <Animated.View entering={enterSection(3)}>
                <Pressable onPress={() => setShowTrust(true)}>
                  {/* keyed on state so the held → released swap crossfades */}
                  <Animated.View key={deal.state} entering={crossfade}>
                    {released || ESCROW_STATES.includes(deal.state) ? (
                      <TrustBanner amountCents={deal.amountCents} released={released} />
                    ) : (
                      // pre-funding: nothing is held yet — speak in the future tense
                      <TrustBanner
                        amountCents={deal.amountCents}
                        title="Escrow protection"
                        subtitle={`${formatMoney(deal.amountCents)} will be held by MeetMe until you both confirm the handoff.`}
                      />
                    )}
                  </Animated.View>
                </Pressable>
              </Animated.View>
            )}

            {(ESCROW_STATES.includes(deal.state) || !!deal.meetupName) && (
              <Animated.View entering={enterSection(4)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                {ESCROW_STATES.includes(deal.state) && (
                  <Animated.View entering={FadeIn.duration(duration.fast)}>
                    <Badge label="Escrow funded" tone="success" iconName="lock-closed" />
                  </Animated.View>
                )}
                {!!deal.meetupName && (
                  <Animated.View entering={FadeIn.duration(duration.fast).delay(30)}>
                    {deal.meetupCustom
                      ? <Badge label="Custom spot" tone="warning" iconName="alert-circle" />
                      : <Badge label="Safe spot set" tone="primary" iconName="shield-checkmark" />}
                  </Animated.View>
                )}
              </Animated.View>
            )}

            {guidance && (
              <Animated.View entering={enterSection(5)} style={{ marginTop: 12 }}>
                {/* keyed on state so new guidance crossfades in */}
                <Animated.View key={deal.state} entering={crossfade}>
                  <Callout tone={guidance.tone} kicker={guidance.kicker} title={guidance.title} body={guidance.body} />
                </Animated.View>
              </Animated.View>
            )}

            {actions.length > 0 && (
              <Animated.View entering={enterSection(6)} style={{ marginTop: 12, gap: 8 }}>
                {actions.map((a, i) => (
                  <Button key={i} label={labelFor(a, deal)} iconName={iconFor(a)} onPress={() => act(a)} />
                ))}
              </Animated.View>
            )}

            {canSetSpot && (
              <Animated.View entering={enterSection(7)} style={{ marginTop: 16 }}>
                <SectionLabel>Meetup spot</SectionLabel>
                <MeetupField
                  selected={deal.meetupName ?? undefined}
                  custom={!!deal.meetupCustom}
                  onPressSelected={openMeetup}
                  onSearch={openMeetup}
                />
              </Animated.View>
            )}

            {(deal.state === 'EN_ROUTE' || deal.state === 'AT_MEETUP') && (
              <Animated.View entering={enterSection(8)} style={{ marginTop: 14, gap: 10 }}>
                <PresenceCard
                  live
                  you={{
                    label: `You (${role})`,
                    status: presenceStatus(role === 'buyer' ? deal.buyerArrived : deal.sellerArrived, role === 'buyer' ? deal.buyerHeadedOut : deal.sellerHeadedOut, null),
                    color: theme.colors[role],
                  }}
                  them={{
                    label: `${oFirst} (${other})`,
                    status: presenceStatus(other === 'buyer' ? deal.buyerArrived : deal.sellerArrived, other === 'buyer' ? deal.buyerHeadedOut : deal.sellerHeadedOut, geo?.distanceM ?? null),
                    color: theme.colors[other],
                  }}
                  showRoute={!mapUrl}
                />
                {!!mapUrl && (
                  <Card padded={false} style={{ overflow: 'hidden' }}>
                    <Image source={{ uri: mapUrl }} style={{ width: '100%', height: 200 }} resizeMode="cover" />
                    <View style={{ position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.success, marginRight: 5 }} />
                      <Text style={{ color: theme.colors.success, fontWeight: '700', fontSize: 12 }}>LIVE</Text>
                    </View>
                  </Card>
                )}
                {deal.state === 'EN_ROUTE' && (
                  <>
                    <Button variant="secondary" label="Share my live location" iconName="navigate" onPress={shareLocation} />
                    {geo && !geo.coLocated && geo.distanceM != null && (
                      <Text style={{ color: theme.colors.textDim }}>{geo.distanceM} m apart — keep going.</Text>
                    )}
                  </>
                )}
              </Animated.View>
            )}

            {deal.state === 'AT_MEETUP' && role === 'buyer' && deal.codeRevealed && (
              <Animated.View
                // the ta-da moment — a soft spring pop when the code appears
                entering={reduceMotion
                  ? FadeIn.duration(duration.base)
                  : ZoomIn.springify().damping(spring.damping).stiffness(spring.stiffness).mass(spring.mass)}
              >
                <Card style={{ marginTop: 14, alignItems: 'center' }}>
                  <Text style={{ fontSize: theme.type.size.xxl, fontWeight: theme.type.weight.bold, letterSpacing: 6, color: theme.colors.primary, textAlign: 'center' }}>{code || '••••'}</Text>
                  <Text style={{ color: theme.colors.textMuted, fontSize: theme.type.size.xs, marginTop: 8, textAlign: 'center' }}>Show this to the seller — don't text it.</Text>
                </Card>
              </Animated.View>
            )}
            {deal.state === 'AT_MEETUP' && role === 'seller' && (
              <Animated.View entering={enterSection(8)} style={{ marginTop: 14 }}>
                <TextInput value={code} onChangeText={setCode} placeholder="release code" keyboardType="number-pad" style={inputStyle(theme)} />
                <Button label="Verify code" iconName="key" onPress={() => act({ type: 'ENTER_CODE', code })} />
              </Animated.View>
            )}

            {deal.state === 'DISPUTED' && (
              <View style={{ marginTop: 14, gap: 10 }}>
                <Callout tone="danger" kicker="Dispute open" title="Funds are frozen" body="Both sides explain what happened; a MeetMe specialist reviews and decides." />
                <Card>
                  <SectionLabel>Statements</SectionLabel>
                  {deal.disputePositions.map((p, i) => (
                    <Text key={i} style={{ color: theme.colors.text, marginBottom: 6 }}><Text style={{ fontWeight: '700' }}>{p.actor}:</Text> {p.text}</Text>
                  ))}
                  <TextInput value={statement} onChangeText={setStatement} placeholder="Your account of what happened" multiline style={[inputStyle(theme), { minHeight: 60 }]} />
                  <Button label="Submit statement" disabled={!statement.trim()} onPress={submitStatement} />
                </Card>
                <Card>
                  <SectionLabel>Agree on a resolution</SectionLabel>
                  <Text style={{ color: theme.colors.textDim, fontSize: 12, marginBottom: 8 }}>
                    You: {deal.disputeProposals[role] ?? '—'} · Them: {deal.disputeProposals[other] ?? '—'} — if you both pick the same, it resolves instantly.
                  </Text>
                  <View style={{ flexDirection: 'row', marginBottom: 10 }}>
                    <RolePick label="Release" active={deal.disputeProposals[role] === 'release'} onPress={() => propose('release')} />
                    <View style={{ width: 6 }} />
                    <RolePick label="Refund" active={deal.disputeProposals[role] === 'refund'} onPress={() => propose('refund')} />
                    <View style={{ width: 6 }} />
                    <RolePick label="Split" active={deal.disputeProposals[role] === 'split'} onPress={() => propose('split')} />
                  </View>
                  <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginTop: 4, marginBottom: 6 }}>Or a specialist decides (demo — admin/support console):</Text>
                  <View style={{ flexDirection: 'row' }}>
                    <RolePick label="Release" active={false} onPress={() => resolveDispute('release')} />
                    <View style={{ width: 6 }} />
                    <RolePick label="Refund" active={false} onPress={() => resolveDispute('refund')} />
                    <View style={{ width: 6 }} />
                    <RolePick label="Split" active={false} onPress={() => resolveDispute('split')} />
                  </View>
                </Card>
              </View>
            )}

            {outcome && (
              // keyed on state so the outcome crossfades in when it lands
              <Animated.View key={deal.state} entering={crossfade} style={{ marginTop: 14 }}>
                <Callout tone={outcome.tone} kicker={outcome.kicker} title={outcome.title} body={outcome.body} />
              </Animated.View>
            )}

            {released && (
              <Card style={{ marginTop: 12 }}>
                {deal.ratings[role] !== undefined ? (
                  <Text style={{ color: theme.colors.textDim }}>You rated {deal.ratings[role]}★ — thanks!</Text>
                ) : (
                  <>
                    <Text style={{ fontWeight: '700', marginBottom: 10, color: theme.colors.text }}>Rate your experience</Text>
                    <RatingStars value={0} size={32} onPick={rate} />
                  </>
                )}
              </Card>
            )}

            {['AGREED', 'ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING', 'DISPUTED'].includes(deal.state) && (
              <Animated.View entering={enterSection(9)} style={{ marginTop: 20 }}>
                <SectionLabel>Chat</SectionLabel>
                <Card padded={false} style={{ padding: 10 }}>
                  {messages.length === 0 ? (
                    <Text style={{ color: theme.colors.textMuted, padding: 6 }}>No messages yet — coordinate your meetup here.</Text>
                  ) : (
                    messages.map((m, i) => {
                      const mine = m.senderId === myId();
                      return (
                        <Animated.View key={i} entering={reduceMotion ? FadeIn.duration(duration.fast) : FadeInDown.duration(duration.fast)} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', backgroundColor: mine ? theme.colors.primary : theme.colors.surfaceAlt, borderRadius: theme.radius.md, paddingHorizontal: 12, paddingVertical: 7, marginVertical: 3, maxWidth: '82%' }}>
                          <Text style={{ color: mine ? theme.colors.onPrimary : theme.colors.text }}>{m.body}</Text>
                        </Animated.View>
                      );
                    })
                  )}
                </Card>
                <View style={{ flexDirection: 'row', marginTop: 8 }}>
                  <TextInput value={msgInput} onChangeText={setMsgInput} placeholder="Message…" style={[inputStyle(theme), { flex: 1, marginBottom: 0 }]} onSubmitEditing={sendMessage} returnKeyType="send" />
                  <Pressable onPress={sendMessage} style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radius.md, paddingHorizontal: 16, justifyContent: 'center', marginLeft: 8 }} hitSlop={4}>
                    <Ionicons name="send" size={18} color={theme.colors.onPrimary} />
                  </Pressable>
                </View>
              </Animated.View>
            )}

            {['DRAFT', 'AGREED', 'ARMED', 'EN_ROUTE'].includes(deal.state) && (
              <Animated.View entering={enterSection(10)}>
                <Button variant="dangerGhost" label={cancelLabel} onPress={cancelDeal} style={{ marginTop: 18 }} />
              </Animated.View>
            )}

            {['ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING'].includes(deal.state) && (
              <Animated.View entering={enterSection(10)}>
                <Button variant="dangerGhost" iconName="shield" label="Feel unsafe? Leave safely" onPress={leaveSafely} style={{ marginTop: 10 }} />
              </Animated.View>
            )}

            {['ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING'].includes(deal.state) && (
              <Animated.View entering={enterSection(10)}>
                <Pressable onPress={openDispute} style={{ marginTop: 14 }}>
                  <Text style={{ color: theme.colors.danger, textAlign: 'center' }}>Something wrong? Report a problem</Text>
                </Pressable>
              </Animated.View>
            )}

            {['AGREED', 'ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING', 'DISPUTED'].includes(deal.state) && (
              <Animated.View entering={enterSection(10)}>
                <Pressable onPress={reportOrBlock} style={{ marginTop: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
                  <Ionicons name="flag-outline" size={14} color={theme.colors.textMuted} />
                  <Text style={{ color: theme.colors.textMuted, textAlign: 'center', marginLeft: 5 }}>Report or block {theirName()}</Text>
                </Pressable>
              </Animated.View>
            )}

            <SectionLabel style={{ marginTop: 22 }}>Money</SectionLabel>
            {transfers.map((t, i) => (
              <Text key={i} style={{ color: theme.colors.textMuted, fontSize: 13 }}>{t.direction} · {t.status} · ${(t.amountCents / 100).toFixed(2)}</Text>
            ))}
            {busy && <ActivityIndicator style={{ marginTop: 12 }} />}
              </>
            );
          })()}
        </ScrollView>
      </KeyboardAvoidingView>

      <TrustModal visible={showTrust} amount={deal?.amountCents ?? 0} onClose={() => setShowTrust(false)} />

      <ProfileModal
        visible={profileOpen}
        loading={profileLoading}
        profile={profile}
        onClose={() => setProfileOpen(false)}
        onReportBlock={() => { setProfileOpen(false); reportOrBlock(); }}
      />

      <Modal visible={meetupOpen} animationType="slide" transparent onRequestClose={() => setMeetupOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: theme.colors.overlay }}>
          <View style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 22, paddingBottom: 30, maxHeight: '88%' }}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={{ fontSize: 22, fontWeight: '800', marginBottom: 4, color: theme.colors.text }}>Find a fair meeting spot</Text>
              <Text style={{ color: theme.colors.textDim, marginBottom: 14 }}>Safe public spots roughly halfway — balanced by drive time for both of you. Enter where you're coming from (this is only used to find the midpoint).</Text>
              <TextInput value={comingFrom} onChangeText={setComingFrom} placeholder="Your starting area or address" style={inputStyle(theme)} />
              <Button label="Find spots from this address" iconName="search" onPress={shareFromAddress} />
              <Button variant="secondary" label="Use my current location" iconName="locate" onPress={shareFromCurrentLocation} style={{ marginTop: 8, marginBottom: 8 }} />
              {!!meetupMsg && <Text style={{ color: theme.colors.textDim, marginBottom: 10 }}>{meetupMsg}</Text>}
              {deal && suggestions.map((s, i) => {
                const mine = myRole(deal) === 'buyer' ? s.minutesBuyer : s.minutesSeller;
                const theirs = myRole(deal) === 'buyer' ? s.minutesSeller : s.minutesBuyer;
                return (
                  <Pressable key={i} onPress={() => chooseMeetup(s)}>
                    <Card style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name={s.tier === 'verified' ? 'shield-checkmark' : 'business'} size={20} color={s.tier === 'verified' ? theme.colors.primary : theme.colors.textDim} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={{ fontWeight: '600', color: theme.colors.text }} numberOfLines={1}>{s.name}</Text>
                        <Text style={{ color: theme.colors.textDim, fontSize: 12 }}>{s.tier === 'verified' ? 'Verified · ' : s.category + ' · '}{mine != null ? `you ${mine}m` : '—'} · {theirs != null ? `them ${theirs}m` : '—'}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                    </Card>
                  </Pressable>
                );
              })}
              <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: 14 }} />
              <Text style={{ fontWeight: '700', marginBottom: 4, color: theme.colors.text }}>Custom spot</Text>
              <Text style={{ color: theme.colors.textDim, fontSize: 12, marginBottom: 8 }}>Pick your own place — but it won't be a verified safe location.</Text>
              <TextInput value={customSpot} onChangeText={setCustomSpot} placeholder="Custom address" style={inputStyle(theme)} />
              <Button variant="secondary" label="Use a custom spot" onPress={useCustomSpot} />
              <Pressable onPress={() => setMeetupOpen(false)} style={{ marginTop: 12 }}><Text style={{ color: theme.colors.textDim, textAlign: 'center' }}>Close</Text></Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
