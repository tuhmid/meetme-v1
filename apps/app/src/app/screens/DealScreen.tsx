// One deal from draft to done: escrow status, actions, meetup, chat, disputes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn, useReducedMotion } from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { Role } from '../../api';
import { supabase } from '../../supabase';
import { useTheme } from '../../theme';
import { Accordion, Button, Callout, Card, DealCard, MeetupField, PresenceCard, RatingStars, SectionLabel, Stepper } from '../../ui';
import { QrScanner } from '../../ui/QrScanner'; // imported directly (keeps native expo-camera out of the ui barrel)
import { ChatModal } from '../ChatModal';
import { useApp } from '../AppContext';
import { MeetupTimePicker, ProfileModal, RoleBar, RolePick, SpringSheet, TrustModal } from '../components';
import { countdownTo, describeTransfer, ESCROW_STATES, formatMeetupTime, formatMoney, iconFor, inputStyle, labelFor, nextActions, outcomeFor, presenceStatus, STEP_INDEX, turnGuidance } from '../dealLogic';

export default function DealScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const reduceMotion = useReducedMotion();
  const [scanOpen, setScanOpen] = useState(false); // QR scanner modal (seller side)
  const [chatOpen, setChatOpen] = useState(false); // full-screen chat
  const [helpOpen, setHelpOpen] = useState(false); // help & safety sheet
  const [lastSeenMsgCount, setLastSeenMsgCount] = useState<Record<string, number>>({}); // per-user seen count for the unread badge
  const { duration, spring } = theme.motion;
  // staggered section entrance; plain fade when the user prefers reduced motion
  const enterSection = (i: number) =>
    reduceMotion ? FadeIn.duration(duration.base).delay(i * 45) : FadeInDown.duration(duration.base).delay(i * 45);
  const crossfade = FadeIn.duration(duration.base);
  const {
    session, demo, viewAs, setViewAs,
    banner, setBanner, err, busy,
    dealId, deal, transfers, code, setCode, geo, names, rep, mapUrl,
    messages, msgInput, setMsgInput, pendingImageUri, statement, setStatement,
    showTrust, setShowTrust, profile, profileOpen, setProfileOpen, profileLoading,
    meetupOpen, setMeetupOpen, comingFrom, setComingFrom, customSpot, setCustomSpot, suggestions, meetupMsg,
    myId, myRole, refresh, pullDeal, loadMessages, bearer,
    act, rate, sendMessage, attachImage, cancelDeal, leaveSafely, openDispute, reportOrBlock, theirName,
    openProfile, openMeetup, propose, resolveDispute, submitStatement,
    shareFromAddress, chooseMeetup, useCustomSpot, confirmMeetup, reschedule, proposeTime, setProposeTime,
  } = useApp();

  // Seller's release code auto-submits — typed, scanned, OR pre-filled (demo shares the
  // buyer's revealed code). No submit button. The ref stops a wrong code from re-firing
  // in a loop; editing the code clears the guard so a corrected code submits.
  const submittedCode = useRef<string | null>(null);
  const sellerAtMeetup = !!deal && deal.state === 'AT_MEETUP' && myRole(deal) === 'seller';
  useEffect(() => {
    if (!sellerAtMeetup) { submittedCode.current = null; return; }
    if (code.length === 6 && submittedCode.current !== code) {
      submittedCode.current = code;
      act({ type: 'ENTER_CODE', code });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellerAtMeetup, code]);

  // Chat-bubble unread badge, tracked PER USER (so switching demo personas — or two real
  // devices — each see their own unread). "Seen" = you had the chat open at that count;
  // unread only counts messages the OTHER person sent since then.
  const me = myId();
  useEffect(() => { if (chatOpen) setLastSeenMsgCount((s) => ({ ...s, [me]: messages.length })); }, [chatOpen, messages.length, me]);
  const unread = messages.slice(lastSeenMsgCount[me] ?? 0).filter((m) => m.senderId !== me).length;

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
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: 90 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {!session && demo && (
            <RoleBar viewAs={viewAs} users={demo} onToggle={() => setViewAs((r) => (r === 'buyer' ? 'seller' : 'buyer'))} />
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
            return (
              <>
            <Pressable onPress={() => navigation.goBack()}><Text style={{ color: theme.colors.primary, marginBottom: 10 }}>← My deals</Text></Pressable>

            <Animated.View entering={enterSection(0)}>
              <DealCard
                item={deal.itemDescription}
                amountCents={deal.amountCents}
                tag={deal.state === 'RELEASED' ? 'RELEASED' : 'ESCROW'}
                metaLine={
                  deal.meetupConfirmed && deal.meetupName
                    ? `${deal.meetupName} · ${formatMeetupTime(deal.meetupTime)}`
                    : deal.meetupName
                      ? `${deal.meetupName} · proposed`
                      : 'Meetup not arranged yet'
                }
                people={{ a: meName, b: oName, label: `You & ${oFirst}`, aColor: theme.colors[role], bColor: theme.colors[other] }}
                // no star rating here: trustScore isn't a star average — the honest
                // "trust N/100 · N deals" line below covers reputation until we
                // aggregate real per-user star ratings.
              />
            </Animated.View>

            {/* Money-safety reassurance sits with the deal identity — a slim tappable line. */}
            {!hideTrustBanner && (
              <Animated.View entering={enterSection(1)}>
                <Pressable
                  onPress={() => setShowTrust(true)}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', marginTop: 10,
                    backgroundColor: theme.colors.successSoft, borderWidth: 1, borderColor: theme.colors.primaryBorder,
                    borderRadius: theme.radius.lg, paddingVertical: 11, paddingHorizontal: 14, opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Ionicons name={released ? 'checkmark-done-circle' : 'shield-checkmark'} size={19} color={released ? theme.colors.success : theme.colors.primary} />
                  <Text style={{ flex: 1, marginLeft: 10, color: theme.colors.text, fontWeight: '600', fontSize: 13.5 }} numberOfLines={1}>
                    {released
                      ? `${formatMoney(deal.amountCents)} released to the seller`
                      : ESCROW_STATES.includes(deal.state)
                        ? `${formatMoney(deal.amountCents)} held safely in escrow`
                        : `${formatMoney(deal.amountCents)} protected by escrow`}
                  </Text>
                  <Text style={{ color: theme.colors.primary, fontWeight: '600', fontSize: 13 }}>How it works ›</Text>
                </Pressable>
              </Animated.View>
            )}

            <Animated.View entering={enterSection(2)}>
              <Pressable onPress={openProfile} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 14 }} hitSlop={8}>
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

            {/* The focus: what's happening now + the one thing to do. */}
            {guidance && (
              <Animated.View entering={enterSection(3)} style={{ marginTop: 4 }}>
                {/* keyed on state so new guidance crossfades in */}
                <Animated.View key={deal.state} entering={crossfade}>
                  <Callout tone={guidance.tone} kicker={guidance.kicker} title={guidance.title} body={guidance.body} />
                </Animated.View>
              </Animated.View>
            )}

            {actions.length > 0 && (
              <Animated.View entering={enterSection(4)} style={{ marginTop: 12, gap: 8 }}>
                {actions.map((a, i) => (
                  <Button key={i} label={labelFor(a, deal)} iconName={iconFor(a)} onPress={() => act(a)} />
                ))}
              </Animated.View>
            )}

            {/* Arrange the meetup: propose spot + time; the OTHER side confirms. */}
            {canSetSpot && !deal.meetupConfirmed && (
              <Animated.View entering={enterSection(7)} style={{ marginTop: 16 }}>
                <SectionLabel>Arrange the meetup</SectionLabel>
                {deal.meetupName && deal.meetupProposedBy && deal.meetupProposedBy !== role ? (
                  // they proposed — confirm or suggest a change
                  <Card>
                    <Text style={{ color: theme.colors.textMuted, fontSize: 12, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>{oFirst} proposes</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                      <Ionicons name={deal.meetupCustom ? 'alert-circle' : 'shield-checkmark'} size={18} color={deal.meetupCustom ? theme.colors.warning : theme.colors.primary} />
                      <Text style={{ fontWeight: '700', color: theme.colors.text, marginLeft: 8, flex: 1 }} numberOfLines={1}>{deal.meetupName}</Text>
                    </View>
                    <Text style={{ color: theme.colors.textDim, fontSize: 13, marginBottom: 12 }}>{formatMeetupTime(deal.meetupTime)}{deal.meetupCustom ? ' · custom spot' : ''}</Text>
                    <Button label="Confirm meetup" iconName="checkmark-circle" onPress={confirmMeetup} />
                    <Pressable onPress={reschedule} style={{ marginTop: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
                      <Ionicons name="options-outline" size={15} color={theme.colors.primary} />
                      <Text style={{ color: theme.colors.primary, marginLeft: 6 }}>Suggest a different spot or time</Text>
                    </Pressable>
                  </Card>
                ) : deal.meetupName && deal.meetupProposedBy === role ? (
                  // I proposed — waiting on them
                  <Card>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                      <Ionicons name="time-outline" size={18} color={theme.colors.textDim} />
                      <Text style={{ fontWeight: '700', color: theme.colors.text, marginLeft: 8, flex: 1 }} numberOfLines={1}>{deal.meetupName}</Text>
                    </View>
                    <Text style={{ color: theme.colors.textDim, fontSize: 13, marginBottom: 12 }}>{formatMeetupTime(deal.meetupTime)} · waiting for {oFirst} to confirm</Text>
                    <Pressable onPress={reschedule} style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
                      <Ionicons name="options-outline" size={15} color={theme.colors.primary} />
                      <Text style={{ color: theme.colors.primary, marginLeft: 6 }}>Change the spot or time</Text>
                    </Pressable>
                  </Card>
                ) : suggestions.length > 0 ? (
                  // nothing proposed yet — propose the top spot + a time
                  (() => {
                    const top = suggestions[0];
                    const mine = role === 'buyer' ? top.minutesBuyer : top.minutesSeller;
                    const theirs = role === 'buyer' ? top.minutesSeller : top.minutesBuyer;
                    return (
                      <Card>
                        {/* spot — name is the hero; the "fair" signal is a colored accent, not gray */}
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Ionicons name={top.tier === 'verified' ? 'shield-checkmark' : 'business'} size={20} color={top.tier === 'verified' ? theme.colors.primary : theme.colors.textDim} />
                          <Text style={{ fontWeight: '800', fontSize: 16, color: theme.colors.text, marginLeft: 8, flex: 1 }} numberOfLines={1}>{top.name}</Text>
                        </View>
                        {mine != null && theirs != null && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: theme.colors.primarySoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginTop: 8 }}>
                            <Ionicons name="car-outline" size={13} color={theme.colors.primary} />
                            <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 12, marginLeft: 5 }}>Fair · you {mine}m · them {theirs}m</Text>
                          </View>
                        )}
                        <Text style={{ color: theme.colors.textDim, fontSize: 13, marginTop: 8, marginBottom: 14 }}>
                          {top.tier === 'verified' ? 'Verified safe-exchange spot' : top.category}
                        </Text>

                        <MeetupTimePicker value={proposeTime} onChange={setProposeTime} />

                        <Button label={`Propose ${formatMeetupTime(proposeTime)} to ${oFirst}`} iconName="paper-plane" onPress={() => chooseMeetup(top)} style={{ marginTop: 16 }} />
                        <Pressable onPress={openMeetup} style={{ marginTop: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
                          <Ionicons name="options-outline" size={15} color={theme.colors.primary} />
                          <Text style={{ color: theme.colors.primary, marginLeft: 6 }}>Change or set a custom spot</Text>
                        </Pressable>
                      </Card>
                    );
                  })()
                ) : (
                  <>
                    <MeetupField selected={undefined} custom={false} onPressSelected={openMeetup} onSearch={openMeetup} />
                    {!!meetupMsg && <Text style={{ color: theme.colors.textDim, marginTop: 8, fontSize: 13 }}>{meetupMsg}</Text>}
                  </>
                )}
              </Animated.View>
            )}

            {/* Confirmed meetup + countdown (persists into EN_ROUTE) */}
            {deal.meetupConfirmed && ['ARMED', 'EN_ROUTE', 'AT_MEETUP'].includes(deal.state) && (
              <Animated.View entering={enterSection(7)} style={{ marginTop: 16 }}>
                <SectionLabel>Meetup</SectionLabel>
                <Card>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name={deal.meetupCustom ? 'alert-circle' : 'shield-checkmark'} size={18} color={deal.meetupCustom ? theme.colors.warning : theme.colors.primary} />
                    <View style={{ flex: 1, marginLeft: 8 }}>
                      <Text style={{ fontWeight: '700', color: theme.colors.text }} numberOfLines={1}>{deal.meetupName}</Text>
                      <Text style={{ color: theme.colors.textDim, fontSize: 13 }}>
                        {formatMeetupTime(deal.meetupTime)}{deal.meetupTime != null ? ` · ${countdownTo(deal.meetupTime)}` : " · head out when you're both ready"}
                      </Text>
                    </View>
                  </View>
                  {deal.state === 'ARMED' && (
                    <Pressable onPress={reschedule} style={{ marginTop: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
                      <Ionicons name="calendar-outline" size={15} color={theme.colors.primary} />
                      <Text style={{ color: theme.colors.primary, marginLeft: 6 }}>Reschedule</Text>
                    </Pressable>
                  )}
                </Card>
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
                    {(role === 'buyer' ? deal.buyerHeadedOut : deal.sellerHeadedOut) ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 2 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.success }} />
                        <Text style={{ color: theme.colors.textDim, flex: 1 }}>
                          Sharing your live location — you'll check in automatically at the spot.
                        </Text>
                      </View>
                    ) : (
                      <Text style={{ color: theme.colors.textDim }}>Tap "I'm heading out" when you leave — we'll track the rest.</Text>
                    )}
                    {geo && !geo.coLocated && geo.distanceM != null && (
                      <Text style={{ color: theme.colors.textDim }}>{geo.distanceM} m apart — closing in.</Text>
                    )}
                  </>
                )}
              </Animated.View>
            )}

            {deal.state === 'AT_MEETUP' && role === 'buyer' && !!code && (
              <Animated.View
                // the ta-da moment — a soft spring pop when the code appears
                entering={reduceMotion
                  ? FadeIn.duration(duration.base)
                  : ZoomIn.springify().damping(spring.damping).stiffness(spring.stiffness).mass(spring.mass)}
              >
                <Card style={{ marginTop: 14, alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textMuted, fontSize: theme.type.size.xs, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 12 }}>Let the seller scan this</Text>
                  <View style={{ backgroundColor: '#fff', padding: 14, borderRadius: 12 }}>
                    <QRCode value={`MEETME:${code}`} size={188} backgroundColor="#fff" color="#000" />
                  </View>
                  <Text style={{ color: theme.colors.textDim, fontSize: theme.type.size.xs, marginTop: 14 }}>Or read them this code — don't text it:</Text>
                  <Text style={{ fontSize: theme.type.size.xxl, fontWeight: theme.type.weight.bold, letterSpacing: 6, color: theme.colors.primary, textAlign: 'center', marginTop: 4 }}>{code}</Text>
                </Card>
              </Animated.View>
            )}
            {deal.state === 'AT_MEETUP' && role === 'seller' && (
              <Animated.View entering={enterSection(8)} style={{ marginTop: 14, gap: 8 }}>
                <Button label="Scan buyer's QR" iconName="qr-code" onPress={() => setScanOpen(true)} />
                <Text style={{ color: theme.colors.textMuted, textAlign: 'center', fontSize: theme.type.size.xs }}>or enter the 6-digit code</Text>
                <TextInput
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))} // effect auto-submits at 6 digits
                  placeholder="123456"
                  keyboardType="number-pad"
                  maxLength={6}
                  style={[inputStyle(theme), { textAlign: 'center', letterSpacing: 4, fontSize: theme.type.size.lg }]}
                />
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

            {/* Chat now lives in a floating bubble (rendered below the scroll) — always one tap away. */}

            {/* Safety-critical: keep "Leave safely" one tap away during a live meetup. */}
            {(['AT_MEETUP', 'CONFIRMING'].includes(deal.state) ||
              (deal.state === 'EN_ROUTE' && (role === 'buyer' ? deal.buyerHeadedOut : deal.sellerHeadedOut))) && (
              <Animated.View entering={enterSection(10)}>
                <Button variant="dangerGhost" iconName="shield" label="Feel unsafe? Leave safely" onPress={leaveSafely} style={{ marginTop: 18 }} />
              </Animated.View>
            )}

            {/* Everything else (cancel / report a problem / block) collapses into one calm entry. */}
            {['DRAFT', 'AGREED', 'ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING', 'DISPUTED'].includes(deal.state) && (
              <Pressable onPress={() => setHelpOpen(true)} style={{ marginTop: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 6 }}>
                <Ionicons name="ellipsis-horizontal-circle-outline" size={16} color={theme.colors.textMuted} />
                <Text style={{ color: theme.colors.textMuted, marginLeft: 6 }}>Help &amp; safety</Text>
              </Pressable>
            )}

            {transfers.length > 0 && (
              <View style={{ marginTop: 18 }}>
                <Accordion title="Payment activity">
                  {transfers.map((t, i) => {
                    const d = describeTransfer(t);
                    const dot = d.failed ? theme.colors.danger : d.done ? theme.colors.success : theme.colors.textMuted;
                    return (
                      <View key={i} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot, marginRight: 8 }} />
                          <Text style={{ color: theme.colors.text, fontSize: 14 }}>{d.label}</Text>
                        </View>
                        <Text style={{ color: theme.colors.textDim, fontSize: 13 }}>{formatMoney(t.amountCents)} · {d.status}</Text>
                      </View>
                    );
                  })}
                </Accordion>
              </View>
            )}
            {busy && <ActivityIndicator style={{ marginTop: 12 }} />}
              </>
            );
          })()}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Floating chat bubble — always one tap away (messaging is the whole point). */}
      {deal && ['AGREED', 'ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING', 'DISPUTED'].includes(deal.state) && !chatOpen && (
        <Animated.View entering={reduceMotion ? FadeIn.duration(200) : ZoomIn.springify().damping(14).stiffness(180)} style={{ position: 'absolute', right: 18, bottom: 24 }}>
          <Pressable
            onPress={() => setChatOpen(true)}
            style={({ pressed }) => ({
              width: 58, height: 58, borderRadius: 29, backgroundColor: theme.colors.primary,
              alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.94 : 1 }],
              shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
            })}
          >
            <Ionicons name="chatbubble-ellipses" size={26} color={theme.colors.onPrimary} />
            {unread > 0 && (
              <Animated.View
                key={unread}
                entering={reduceMotion ? FadeIn.duration(150) : ZoomIn.springify().damping(11).stiffness(220)}
                style={{ position: 'absolute', top: -3, right: -3, minWidth: 22, height: 22, borderRadius: 11, backgroundColor: theme.colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, borderWidth: 2, borderColor: theme.colors.bg }}
              >
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{unread > 9 ? '9+' : unread}</Text>
              </Animated.View>
            )}
          </Pressable>
        </Animated.View>
      )}

      <TrustModal visible={showTrust} amount={deal?.amountCents ?? 0} onClose={() => setShowTrust(false)} />

      <ProfileModal
        visible={profileOpen}
        loading={profileLoading}
        profile={profile}
        onClose={() => setProfileOpen(false)}
        onReportBlock={() => { setProfileOpen(false); reportOrBlock(); }}
      />

      <SpringSheet visible={meetupOpen} onClose={() => setMeetupOpen(false)}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22, paddingBottom: 30 }}>
          <Text style={{ fontSize: 22, fontWeight: '800', marginBottom: 4, color: theme.colors.text }}>Arrange the meetup</Text>
          <Text style={{ color: theme.colors.textDim, marginBottom: 14 }}>Safe public spots roughly halfway — balanced by drive time for both of you. Pick a time, then tap a spot to propose it.</Text>
          <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700', marginBottom: 10 }}>When?</Text>
          <MeetupTimePicker value={proposeTime} onChange={setProposeTime} />
          <Text style={{ color: theme.colors.textDim, fontSize: 12, marginTop: 12, marginBottom: 14 }}>Tapping a spot proposes it for <Text style={{ fontWeight: '700', color: theme.colors.text }}>{formatMeetupTime(proposeTime)}</Text> — {theirName()} confirms.</Text>
          <TextInput value={comingFrom} onChangeText={setComingFrom} placeholder="Start somewhere else? (optional)" placeholderTextColor={theme.colors.textMuted} style={inputStyle(theme)} />
          <Button variant="secondary" label="Search from this address" iconName="search" onPress={shareFromAddress} style={{ marginBottom: 8 }} />
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
          <TextInput value={customSpot} onChangeText={setCustomSpot} placeholder="Custom address" placeholderTextColor={theme.colors.textMuted} style={inputStyle(theme)} />
          <Button variant="secondary" label="Use a custom spot" onPress={useCustomSpot} />
          <Pressable onPress={() => setMeetupOpen(false)} style={{ marginTop: 12 }}><Text style={{ color: theme.colors.textDim, textAlign: 'center' }}>Close</Text></Pressable>
        </ScrollView>
      </SpringSheet>

      <QrScanner
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={(scanned) => { setScanOpen(false); setCode(scanned); }} // effect submits once code is set
      />

      <ChatModal
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        title={`Chat with ${theirName()}`}
        messages={messages}
        myId={myId()}
        input={msgInput}
        setInput={setMsgInput}
        onSend={sendMessage}
        onAttach={attachImage}
        pendingImageUri={pendingImageUri}
      />

      <SpringSheet visible={helpOpen} onClose={() => setHelpOpen(false)}>
        <View style={{ padding: 22, paddingBottom: 34 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: theme.colors.text, marginBottom: 4 }}>Help &amp; safety</Text>
          <Text style={{ color: theme.colors.textDim, marginBottom: 8 }}>Options for this deal.</Text>
          {deal && (() => {
            const st = deal.state;
            const iOut = myRole(deal) === 'buyer' ? deal.buyerHeadedOut : deal.sellerHeadedOut;
            const row = (key: string, icon: string, title: string, subtitle: string, onPress: () => void, danger = false) => (
              <Pressable key={key} onPress={() => { setHelpOpen(false); onPress(); }} style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 13, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
                <Ionicons name={icon as any} size={22} color={danger ? theme.colors.danger : theme.colors.text} style={{ marginTop: 1 }} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ fontWeight: '700', color: danger ? theme.colors.danger : theme.colors.text }}>{title}</Text>
                  <Text style={{ color: theme.colors.textDim, fontSize: 13, marginTop: 2 }}>{subtitle}</Text>
                </View>
              </Pressable>
            );
            return (
              <>
                {(['AT_MEETUP', 'CONFIRMING'].includes(st) || (st === 'EN_ROUTE' && iOut)) &&
                  row('leave', 'shield', 'Leave safely', 'Quietly exit the meetup and get to a safe place.', leaveSafely)}
                {['ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING'].includes(st) &&
                  row('dispute', 'alert-circle', 'Report a problem', 'Freezes the funds and opens a dispute for review.', openDispute)}
                {['AGREED', 'ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING', 'DISPUTED'].includes(st) &&
                  row('block', 'flag', `Report or block ${theirName()}`, 'Stop messages and flag this person to MeetMe.', reportOrBlock)}
                {['DRAFT', 'AGREED', 'ARMED', 'EN_ROUTE'].includes(st) &&
                  row('cancel', 'close-circle', 'Cancel deal', st === 'EN_ROUTE' ? `Backing out now forfeits your ${formatMoney(deal.commitmentCents)} deposit.` : 'Everything funded comes back in full.', cancelDeal, true)}
              </>
            );
          })()}
        </View>
      </SpringSheet>
    </SafeAreaView>
  );
}
