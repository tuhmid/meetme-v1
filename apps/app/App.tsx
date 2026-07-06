import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Image, KeyboardAvoidingView, LayoutAnimation, Linking, Modal, Platform, Pressable, SafeAreaView, ScrollView, Text, TextInput, UIManager, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Swipeable } from 'react-native-gesture-handler';
import { api, type Action, type Deal, type Invite, type MeetupSpot, type Role, type Transfer, type UserProfile } from './src/api';
import { supabase } from './src/supabase';
import { registerForPush } from './src/push';
import { ThemeProvider, useTheme, ThemeToggle } from './src/theme';
import {
  Badge,
  Button,
  Callout,
  Card,
  DealCard,
  DealHistoryRow,
  MeetupField,
  PresenceCard,
  RatingStars,
  SectionLabel,
  Stepper,
  TrustBanner,
  UIGallery,
  type IconName,
  type Tone,
} from './src/ui';
import type { Theme } from './src/theme/types';

// Two modes:
//  • Real login — phone OTP (Supabase Auth). One identity per device; live updates
//    over Supabase Realtime; push notifications.
//  • Demo mode — one device drives BOTH parties via a "Viewing as" toggle (dev
//    login, polling). Handy for testing without two phones.
type Phase = 'login' | 'home' | 'deal';
interface Session { userId: string; name: string; accessToken: string }
interface DemoUsers { buyer: { id: string; name: string }; seller: { id: string; name: string } }
// --- input masks / validation (US phone + USD amount) ---
const phoneDigits = (v: string): string => v.replace(/\D/g, '').replace(/^1/, '').slice(0, 10);
const formatPhone = (v: string): string => {
  const d = phoneDigits(v);
  if (d.length > 6) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length > 3) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return d;
};
const toE164 = (v: string): string => '+1' + phoneDigits(v);
const phoneValid = (v: string): boolean => phoneDigits(v).length === 10;
const centsFromInput = (v: string): number => parseInt(v.replace(/\D/g, '') || '0', 10); // cash-register style
const formatMoney = (cents: number): string => `$${(cents / 100).toFixed(2)}`; // exact — never rounds to whole dollars
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) UIManager.setLayoutAnimationEnabledExperimental(true);
const gentle = () => LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));

function AppRoot() {
  const theme = useTheme();
  const [phase, setPhase] = useState<Phase>('login');
  const [session, setSession] = useState<Session | null>(null); // real auth
  const [demo, setDemo] = useState<DemoUsers | null>(null); // demo relay
  const [viewAs, setViewAs] = useState<Role>('buyer'); // demo only

  const [deals, setDeals] = useState<Deal[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [dealId, setDealId] = useState<string | null>(null);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [code, setCode] = useState('');
  const [banner, setBanner] = useState('');
  const [geo, setGeo] = useState<{ distanceM: number | null; coLocated: boolean } | null>(null);
  const [names, setNames] = useState<{ buyer: string; seller: string }>({ buyer: 'Buyer', seller: 'Seller' });
  const [rep, setRep] = useState<{ buyerTrust: number | null; sellerTrust: number | null; buyerDeals: number; sellerDeals: number }>({ buyerTrust: null, sellerTrust: null, buyerDeals: 0, sellerDeals: 0 });
  const [showTrust, setShowTrust] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [statement, setStatement] = useState(''); // dispute statement input
  const [mapUrl, setMapUrl] = useState<string | null>(null); // live Geoapify map (during meetup)
  const [meetupOpen, setMeetupOpen] = useState(false);
  const [comingFrom, setComingFrom] = useState('');
  const [customSpot, setCustomSpot] = useState('');
  const [suggestions, setSuggestions] = useState<MeetupSpot[]>([]);
  const [meetupMsg, setMeetupMsg] = useState('');
  const [messages, setMessages] = useState<{ senderId: string; body: string; createdAt: number }[]>([]);
  const [msgInput, setMsgInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const lastState = useRef<string | null>(null);
  const screenFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (phase !== 'deal') setBanner(''); // don't let a deal banner linger on Home/login
    screenFade.setValue(0);
    Animated.timing(screenFade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [phase, screenFade]);

  // login form
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('555-123-0001');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [cpPhone, setCpPhone] = useState('555-123-0002'); // counterparty (real mode)

  // new-deal / invite form (nothing hardcoded — these drive the amount + item)
  const [item, setItem] = useState('');
  const [amountCents, setAmountCents] = useState(0);
  const [inviteRole, setInviteRole] = useState<Role>('buyer'); // the inviter's side
  const dealValid = () => !!item.trim() && amountCents > 0;
  const inviteValid = () => dealValid() && phoneValid(cpPhone);

  // identity helpers — "real" mode uses the JWT + logged-in user; demo uses dev tokens
  const uidDemo = () => (demo ? (viewAs === 'buyer' ? demo.buyer.id : demo.seller.id) : '');
  const bearer = () => (session ? session.accessToken : `dev:${uidDemo()}`);
  const myId = () => (session ? session.userId : uidDemo());
  const myRole = (d: Deal): Role => (session ? (d.buyerId === session.userId ? 'buyer' : 'seller') : viewAs);
  const otherName = () => (demo ? (viewAs === 'buyer' ? demo.seller.name : demo.buyer.name) : 'the other party');

  const run = async (fn: () => Promise<void>) => {
    setErr('');
    setBusy(true);
    try { await fn(); } catch (e: any) { setErr(String(e.message ?? e)); } finally { setBusy(false); }
  };

  const showDeal = (d: Deal, tr?: Transfer[]) => {
    if (lastState.current && lastState.current !== d.state) { gentle(); setBanner(stateBanner(d.state)); }
    lastState.current = d.state;
    setDeal(d);
    if (tr) setTransfers(tr);
  };
  const pullDeal = async (auth: string, id: string) => {
    const d = await api.getDeal(auth, id);
    showDeal(d.deal, d.transfers);
    setNames({ buyer: d.buyerName ?? 'Buyer', seller: d.sellerName ?? 'Seller' });
    setRep({ buyerTrust: d.buyerTrust, sellerTrust: d.sellerTrust, buyerDeals: d.buyerDeals, sellerDeals: d.sellerDeals });
    setMapUrl(d.mapUrl);
  };
  const rate = (stars: number) => act({ type: 'RATE', actor: myRole(deal!), stars });

  // restore/refresh a real session; keeps the access token fresh
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) {
        // Push the token to the Realtime socket so RLS-gated changes (chat, deals,
        // transfers) actually deliver — without this the socket runs as anon.
        supabase.realtime.setAuth(s.access_token);
        setSession({ userId: s.user.id, name: (s.user.user_metadata?.name as string) ?? 'Me', accessToken: s.access_token });
        setPhase((p) => (p === 'login' ? 'home' : p));
      } else {
        setSession(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // ---- auth actions ----
  const sendCode = () =>
    run(async () => {
      if (!phoneValid(phone)) { setErr('Enter a 10-digit phone number.'); return; }
      const { error } = await supabase.auth.signInWithOtp({ phone: toE164(phone), options: { data: { name } } });
      if (error) throw error;
      setOtpSent(true);
    });

  const verifyCode = () =>
    run(async () => {
      const { data, error } = await supabase.auth.verifyOtp({ phone: toE164(phone), token: otp, type: 'sms' });
      if (error) throw error;
      const s = data.session!;
      const sess: Session = { userId: data.user!.id, name: name || 'Me', accessToken: s.access_token };
      setSession(sess);
      setDemo(null);
      setPhase('home');
      // keep the server profile name in sync with what they typed (so the counterparty sees it)
      if (name.trim()) { try { await api.updateProfile(sess.accessToken, name.trim()); } catch { /* ignore */ } }
      const token = await registerForPush(); // best-effort; needs a dev build to actually deliver
      if (token) { try { await api.registerPushToken(sess.accessToken, token, Platform.OS); } catch { /* ignore */ } }
    });

  const startDemo = () =>
    run(async () => {
      const b = await api.signup(`+1555${Date.now()}1`, 'Maya Chen');
      const s = await api.signup(`+1555${Date.now()}2`, 'Sam Rivera');
      setDemo({ buyer: { id: b.userId, name: b.name }, seller: { id: s.userId, name: s.name } });
      setSession(null);
      setViewAs('buyer');
      setPhase('home');
    });

  const logout = () =>
    run(async () => {
      await supabase.auth.signOut();
      setSession(null); setDemo(null); setDeals([]); setDeal(null); setPhase('login'); setOtpSent(false); setOtp('');
    });

  // ---- deal data ----
  const loadHome = () =>
    run(async () => {
      setDeals((await api.listDeals(bearer())).deals);
      if (session) setInvites((await api.listInvites(session.accessToken)).invites);
    });
  const openDeal = (id: string) => { lastState.current = null; setBanner(''); setGeo(null); setCode(''); setMessages([]); setMsgInput(''); setDealId(id); setPhase('deal'); };
  const loadMessages = async (auth: string, id: string) => { try { setMessages((await api.listMessages(auth, id)).messages); } catch { /* transient */ } };
  const sendMessage = () =>
    run(async () => {
      if (!msgInput.trim()) return;
      await api.sendMessage(bearer(), dealId!, msgInput.trim());
      setMsgInput('');
      await loadMessages(bearer(), dealId!);
    });
  const newDeal = () =>
    run(async () => {
      if (!dealValid()) { setErr('Enter an item and an amount.'); return; }
      setViewAs('buyer');
      const { dealId } = await api.createDeal(`dev:${demo!.buyer.id}`, { counterpartyUserId: demo!.seller.id, itemDescription: item.trim(), amountCents });
      openDeal(dealId);
    });

  // real mode: invite someone by phone (as buyer or seller), then optionally text them (skippable)
  const sendInvite = async () => {
    const { token } = await api.createInvite(session!.accessToken, toE164(cpPhone), item.trim(), amountCents, inviteRole);
    await loadHome();
    const verb = inviteRole === 'seller' ? 'sell you' : 'buy';
    const body = `I want to ${verb} "${item.trim()}" for ${formatMoney(amountCents)} on MeetMe (funds held safely in escrow). Get the app and sign in with this number to accept. (ref ${token.slice(0, 8)})`;
    const sep = Platform.OS === 'ios' ? '&' : '?';
    Alert.alert('Invite sent', 'It will appear in their app when they sign in. Text them a heads-up?', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Text them', onPress: () => Linking.openURL(`sms:${toE164(cpPhone)}${sep}body=${encodeURIComponent(body)}`) },
    ]);
  };
  const inviteSomeone = () =>
    run(async () => {
      if (!dealValid()) { setErr('Enter an item and an amount.'); return; }
      if (!phoneValid(cpPhone)) { setErr('Enter their 10-digit phone number.'); return; }
      try {
        await sendInvite();
      } catch (e: any) {
        if (e?.code === 'kyc_required') {
          Alert.alert('ID verification needed', String(e.message ?? 'Verify your ID for larger deals.'), [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Verify ID (demo)', onPress: () => run(async () => { await api.verifyKyc(session!.accessToken); await sendInvite(); }) },
          ]);
          return;
        }
        throw e;
      }
    });

  const acceptInvite = (token: string) =>
    run(async () => {
      const { dealId } = await api.acceptInvite(session!.accessToken, token);
      await loadHome();
      openDeal(dealId);
    });
  const declineInvite = (token: string) => run(async () => { await api.declineInvite(session!.accessToken, token); await loadHome(); });

  const deleteDraft = (id: string) => run(async () => { await api.deleteDeal(bearer(), id); await loadHome(); });

  // back out of a deal — free before heading out, forfeits your commitment after
  const cancelDeal = () => {
    const enRoute = deal!.state === 'EN_ROUTE';
    Alert.alert(
      enRoute ? 'Back out?' : 'Cancel deal?',
      enRoute ? 'You already headed out — backing out now forfeits your commitment.' : 'You can back out for a full refund before anyone heads out.',
      [
        { text: 'Keep deal', style: 'cancel' },
        { text: enRoute ? 'Back out' : 'Cancel deal', style: 'destructive', onPress: () => act({ type: 'CANCEL', actor: myRole(deal!) }) },
      ]
    );
  };
  const propose = (outcome: 'release' | 'refund' | 'split') => act({ type: 'PROPOSE_RESOLUTION', actor: myRole(deal!), outcome });

  // ---- meetup spot (fair-by-time safe spot) ----
  const openMeetup = () => { setSuggestions([]); setMeetupMsg(''); setComingFrom(''); setCustomSpot(''); setMeetupOpen(true); };
  const fetchSuggestions = async () => {
    const r = await api.meetupSuggestions(bearer(), dealId!);
    if (r.needLocation) { setSuggestions([]); setMeetupMsg("Got it — waiting for the other person to share where they're coming from too."); return; }
    if (!r.suggestions.length) { setSuggestions([]); setMeetupMsg('No safe spots found near the midpoint. Try a custom spot below.'); return; }
    setMeetupMsg(''); setSuggestions(r.suggestions);
  };
  const shareFromCurrentLocation = () =>
    run(async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setMeetupMsg('Location permission denied.'); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await api.sendLocation(bearer(), dealId!, pos.coords.latitude, pos.coords.longitude);
      await fetchSuggestions();
    });
  const shareFromAddress = () =>
    run(async () => {
      if (!comingFrom.trim()) { setMeetupMsg('Enter where you are coming from.'); return; }
      const g = await api.geocode(bearer(), comingFrom.trim());
      await api.sendLocation(bearer(), dealId!, g.lat, g.lng);
      await fetchSuggestions();
    });
  const chooseMeetup = (s: MeetupSpot) =>
    run(async () => {
      await api.act(bearer(), dealId!, { type: 'SET_MEETUP', actor: myRole(deal!), name: s.name, lat: s.lat, lng: s.lng, custom: false });
      setMeetupOpen(false);
      await pullDeal(bearer(), dealId!);
    });
  const useCustomSpot = () =>
    run(async () => {
      if (!customSpot.trim()) { setMeetupMsg('Enter a custom address.'); return; }
      const g = await api.geocode(bearer(), customSpot.trim());
      Alert.alert('Use a custom spot?', `"${g.name}" isn't a verified safe location. Public, camera-covered spots — police stations, transit hubs — are safest.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Use it anyway', style: 'destructive', onPress: () => run(async () => {
          await api.act(bearer(), dealId!, { type: 'SET_MEETUP', actor: myRole(deal!), name: g.name, lat: g.lat, lng: g.lng, custom: true });
          setMeetupOpen(false); await pullDeal(bearer(), dealId!);
        }) },
      ]);
    });

  const refresh = () => run(() => pullDeal(bearer(), dealId!));
  useEffect(() => { if (phase === 'deal' && dealId) refresh(); }, [phase, dealId, viewAs, session]);
  useEffect(() => { if (phase === 'home' && (session || demo)) loadHome(); }, [phase, viewAs, session, demo]);

  // keep the home lists (deals + incoming invites) fresh without a manual reload
  const pollHome = async () => {
    try {
      setDeals((await api.listDeals(bearer())).deals);
      if (session) setInvites((await api.listInvites(session.accessToken)).invites);
    } catch { /* transient */ }
  };
  useEffect(() => {
    if (phase !== 'home' || !(session || demo)) return;
    const t = setInterval(pollHome, 4000);
    return () => clearInterval(t);
  }, [phase, session, demo, viewAs]);

  // live updates: Realtime in real-auth mode (RLS delivers to the party); polling in demo mode
  useEffect(() => {
    if (phase !== 'deal' || !dealId) return;
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
  }, [phase, dealId, viewAs, session]);

  const act = (action: Action) =>
    run(async () => {
      const res = await api.act(bearer(), dealId!, action);
      if (res.secret) setCode(res.secret.releaseCode); // minted at REVEAL_CODE, buyer-only
      await pullDeal(bearer(), dealId!);
    });

  const shareLocation = () =>
    run(async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setErr('Location permission denied'); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const r = await api.sendLocation(bearer(), dealId!, pos.coords.latitude, pos.coords.longitude);
      setGeo({ distanceM: r.distanceM, coLocated: r.coLocated });
      await pullDeal(bearer(), dealId!);
    });

  // ---- disputes ----
  const openDispute = () =>
    Alert.alert('Report a problem?', 'This freezes the funds and opens a dispute for review.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open dispute', style: 'destructive', onPress: () => act({ type: 'OPEN_DISPUTE', actor: myRole(deal!) }) },
    ]);
  const submitStatement = () =>
    run(async () => {
      if (!statement.trim()) return;
      await api.act(bearer(), dealId!, { type: 'SUBMIT_POSITION', actor: myRole(deal!), text: statement.trim() });
      setStatement('');
      await pullDeal(bearer(), dealId!);
    });
  const resolveDispute = (outcome: 'release' | 'refund' | 'split') =>
    run(async () => {
      const r = await api.resolveDispute(dealId!, outcome);
      if (!r.ok) { setErr(r.error ?? 'resolve failed'); return; }
      await pullDeal(bearer(), dealId!);
    });

  // ---- safety: report / block / leave safely ----
  const theirId = () => (myRole(deal!) === 'buyer' ? deal!.sellerId : deal!.buyerId);
  const theirName = () => (myRole(deal!) === 'buyer' ? names.seller : names.buyer).split(' ')[0];
  const openProfile = async () => {
    setProfile(null); setProfileLoading(true); setProfileOpen(true);
    try { setProfile(await api.getUserProfile(bearer(), theirId())); }
    catch (e: any) { setErr(e?.message ?? 'could not load profile'); }
    finally { setProfileLoading(false); }
  };
  const reportPerson = (reason: string) =>
    run(async () => {
      await api.reportUser(bearer(), theirId(), reason, dealId!);
      Alert.alert('Report sent', 'Thanks — our safety team will review this. Your report is confidential.');
    });
  const blockPerson = () =>
    Alert.alert(`Block ${theirName()}?`, "You won't be matched or able to start new deals with each other.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: () => run(async () => { await api.blockUser(bearer(), theirId()); Alert.alert('Blocked', `You blocked ${theirName()}.`); setPhase('home'); await loadHome(); }) },
    ]);
  const reportOrBlock = () =>
    Alert.alert(theirName(), 'What would you like to do?', [
      { text: 'Report to MeetMe', onPress: () =>
        Alert.alert('Report — what happened?', undefined, [
          { text: 'Scam or fraud', onPress: () => reportPerson('scam') },
          { text: 'No-show', onPress: () => reportPerson('no_show') },
          { text: 'Harassment or threats', onPress: () => reportPerson('harassment') },
          { text: 'Prohibited item', onPress: () => reportPerson('prohibited') },
          { text: 'Cancel', style: 'cancel' },
        ]) },
      { text: `Block ${theirName()}`, style: 'destructive', onPress: blockPerson },
      { text: 'Cancel', style: 'cancel' },
    ]);
  const leaveSafely = () =>
    Alert.alert('Feel unsafe?', 'Get to a safe place first. You can call 911, or quietly leave this meetup and report it.', [
      { text: 'Call 911', style: 'destructive', onPress: () => Linking.openURL('tel:911') },
      { text: 'Leave & report', onPress: () => run(async () => {
        try { await api.reportUser(bearer(), theirId(), 'safety', dealId!); } catch {}
        // Before the meetup, back out (normal refund/forfeit rules). Once funds are in
        // play at the meetup, freeze them by opening a dispute for review instead.
        const frozen = ['AT_MEETUP', 'CONFIRMING'].includes(deal!.state);
        try {
          await api.act(bearer(), dealId!, frozen
            ? { type: 'OPEN_DISPUTE', actor: myRole(deal!) }
            : { type: 'CANCEL', actor: myRole(deal!) });
        } catch {}
        setPhase('home'); await loadHome();
        Alert.alert('You left the deal', frozen
          ? 'Funds are frozen and our safety team is reviewing. If you are in danger, call 911.'
          : 'Reported to our safety team. If you are in danger, call 911.');
      }) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  // ---- screens ----
  // Render login whenever there's no identity — this also covers the brief frame
  // during logout where the auth listener clears `session` before `phase` flips.
  if (phase === 'login' || (!session && !demo))
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={{ fontSize: 30, fontWeight: '800', color: theme.colors.primary }}>MeetMe</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
          <Ionicons name="shield-checkmark" size={14} color={theme.colors.primary} />
          <Text style={{ color: theme.colors.textDim, marginLeft: 6, fontSize: 13 }}>Escrow-protected in-person deals</Text>
        </View>
        <View style={{ marginTop: 10, marginBottom: 6 }}><ThemeToggle /></View>
        <Text style={{ color: theme.colors.textDim, marginBottom: 22 }}>Sign in with your phone</Text>
        <TextInput value={name} onChangeText={setName} placeholder="Your name" style={inputStyle(theme)} />
        <TextInput value={phone} onChangeText={(t) => setPhone(formatPhone(t))} placeholder="555-123-4567" keyboardType="phone-pad" maxLength={12} style={inputStyle(theme)} />
        {!otpSent ? (
          <Button label="Send code" onPress={sendCode} style={{ marginTop: 4 }} />
        ) : (
          <>
            <TextInput value={otp} onChangeText={setOtp} placeholder="6-digit code (local: 123456)" keyboardType="number-pad" style={inputStyle(theme)} />
            <Button label="Verify & continue" onPress={verifyCode} style={{ marginTop: 4 }} />
            <Pressable onPress={() => setOtpSent(false)}><Text style={{ color: theme.colors.primary, textAlign: 'center', marginTop: 12 }}>Use a different number</Text></Pressable>
          </>
        )}
        <Text style={{ color: theme.colors.textMuted, textAlign: 'center', marginVertical: 18 }}>— or —</Text>
        <Button variant="secondary" label="Try the demo" onPress={startDemo} />
        <Text style={{ color: theme.colors.textMuted, textAlign: 'center', fontSize: 12, marginTop: 6 }}>Play both sides — Maya & Sam on one device.</Text>
        {busy && <ActivityIndicator style={{ marginTop: 16 }} />}
        {!!err && <Text style={{ color: theme.colors.danger, marginTop: 12 }}>{err}</Text>}
      </ScrollView>
      </KeyboardAvoidingView>
      </SafeAreaView>
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
            <RoleBar viewAs={viewAs} users={demo!} onToggle={() => setViewAs((r) => (r === 'buyer' ? 'seller' : 'buyer'))} />
          )}

          <View style={{ marginBottom: 12, alignItems: 'flex-start' }}><ThemeToggle /></View>
          <Animated.View style={{ opacity: screenFade }}>
          {!!banner && (
            <Pressable onPress={() => setBanner('')} style={{ marginBottom: 10 }}>
              <Callout tone="primary" title={banner} />
            </Pressable>
          )}
          {!!err && <Text style={{ color: theme.colors.danger, marginVertical: 8 }}>{err}</Text>}

          {phase === 'home' && (
            <>
          {session && invites.length > 0 && (
            <>
              <SectionLabel style={{ marginTop: 6 }}>Invites for you</SectionLabel>
              {invites.map((iv) => (
                <Card key={iv.token} style={{ marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Text numberOfLines={1} style={{ flex: 1, fontWeight: '700', fontSize: 16, color: theme.colors.text, marginRight: 10 }}>{iv.itemDescription}</Text>
                    <Text style={{ fontWeight: '700', fontSize: 16, color: theme.colors.text }}>{formatMoney(iv.amountCents)}</Text>
                  </View>
                  <Text style={{ color: theme.colors.textDim, marginTop: 3, fontSize: 13 }}>from {iv.inviterName} · you'd be the {iv.yourRole}</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                    <View style={{ flex: 1 }}><Button label="Accept" onPress={() => acceptInvite(iv.token)} /></View>
                    <View style={{ flex: 1 }}><Button variant="secondary" label="Decline" onPress={() => declineInvite(iv.token)} /></View>
                  </View>
                </Card>
              ))}
            </>
          )}

          <SectionLabel style={{ marginTop: 14 }}>Start a deal</SectionLabel>
          <Card>
            <TextInput value={item} onChangeText={setItem} placeholder="Item (e.g. iPhone 12, 128GB)" style={inputStyle(theme)} />
            <TextInput value={amountCents ? formatMoney(amountCents) : ''} onChangeText={(t) => setAmountCents(centsFromInput(t))} placeholder="$0.00" keyboardType="number-pad" style={inputStyle(theme)} />
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
            </>
          )}

          {phase === 'deal' && deal && (() => {
            const role = myRole(deal);
            const other: Role = role === 'buyer' ? 'seller' : 'buyer';
            const oName = other === 'buyer' ? names.buyer : names.seller;
            const oFirst = oName.split(' ')[0];
            const oTrust = other === 'buyer' ? rep.buyerTrust : rep.sellerTrust;
            const oDeals = other === 'buyer' ? rep.buyerDeals : rep.sellerDeals;
            const meName = role === 'buyer' ? names.buyer : names.seller;
            const released = deal.state === 'RELEASED' || deal.state === 'DISPUTE_RESOLVED';
            const actions = nextActions(deal, role);
            const canSetSpot = ['DRAFT', 'AGREED', 'FUNDED', 'ARMED'].includes(deal.state);
            const stepIndex = STEP_INDEX[deal.state];
            const guidance = turnGuidance(deal, role, oFirst, session ? null : `(Demo: tap "View as ${oFirst}" above to act as them.)`);
            const outcome = outcomeFor(deal, role, oFirst);
            const hideTrustBanner = ['REFUNDED', 'CANCELLED', 'EXPIRED_NO_SHOW'].includes(deal.state);
            const cancelLabel =
              deal.state === 'DRAFT' && role === 'seller' ? 'Decline this deal'
              : deal.state === 'DRAFT' || deal.state === 'AGREED' ? 'Cancel deal'
              : deal.state === 'FUNDED' || deal.state === 'ARMED' ? 'Cancel deal — full refund'
              : `Back out — forfeit ${formatMoney(deal.commitmentCents)}`;
            return (
              <>
            <Pressable onPress={() => setPhase('home')}><Text style={{ color: theme.colors.primary, marginBottom: 10 }}>← My deals</Text></Pressable>

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

            <Pressable onPress={openProfile} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 14 }} hitSlop={8}>
              <Ionicons name="star" size={14} color={theme.colors.star} />
              <Text style={{ color: theme.colors.textDim, marginLeft: 5, flex: 1 }}>{oName} · trust {oTrust ?? '—'}/100 · {oDeals} deal{oDeals === 1 ? '' : 's'}</Text>
              <Ionicons name="chevron-forward" size={14} color={theme.colors.textMuted} />
            </Pressable>

            {stepIndex !== undefined && (
              <View style={{ marginBottom: 14 }}>
                <Stepper steps={['Agree', 'Fund', 'Commit', 'Meet', 'Done']} current={stepIndex} />
              </View>
            )}

            {!hideTrustBanner && (
              <Pressable onPress={() => setShowTrust(true)}>
                {released || FUNDED_STATES.includes(deal.state) ? (
                  <TrustBanner amountCents={deal.amountCents} released={released} />
                ) : (
                  // pre-funding: nothing is held yet — speak in the future tense
                  <TrustBanner
                    amountCents={deal.amountCents}
                    title="Escrow protection"
                    subtitle={`${formatMoney(deal.amountCents)} will be held by MeetMe until you both confirm the handoff.`}
                  />
                )}
              </Pressable>
            )}

            {(FUNDED_STATES.includes(deal.state) || !!deal.meetupName) && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                {FUNDED_STATES.includes(deal.state) && <Badge label="Escrow funded" tone="success" iconName="lock-closed" />}
                {!!deal.meetupName && (deal.meetupCustom
                  ? <Badge label="Custom spot" tone="warning" iconName="alert-circle" />
                  : <Badge label="Safe spot set" tone="primary" iconName="shield-checkmark" />)}
              </View>
            )}

            {guidance && (
              <View style={{ marginTop: 12 }}>
                <Callout tone={guidance.tone} kicker={guidance.kicker} title={guidance.title} body={guidance.body} />
              </View>
            )}

            {actions.length > 0 && (
              <View style={{ marginTop: 12, gap: 8 }}>
                {actions.map((a, i) => (
                  <Button key={i} label={labelFor(a, deal)} iconName={iconFor(a)} onPress={() => act(a)} />
                ))}
              </View>
            )}

            {canSetSpot && (
              <View style={{ marginTop: 16 }}>
                <SectionLabel>Meetup spot</SectionLabel>
                <MeetupField
                  selected={deal.meetupName ?? undefined}
                  custom={!!deal.meetupCustom}
                  onPressSelected={openMeetup}
                  onSearch={openMeetup}
                />
              </View>
            )}

            {(deal.state === 'EN_ROUTE' || deal.state === 'AT_MEETUP') && (
              <View style={{ marginTop: 14, gap: 10 }}>
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
              </View>
            )}

            {deal.state === 'AT_MEETUP' && role === 'buyer' && deal.codeRevealed && (
              <Card style={{ marginTop: 14, alignItems: 'center' }}>
                <Text style={{ fontSize: theme.type.size.xxl, fontWeight: theme.type.weight.bold, letterSpacing: 6, color: theme.colors.primary, textAlign: 'center' }}>{code || '••••'}</Text>
                <Text style={{ color: theme.colors.textMuted, fontSize: theme.type.size.xs, marginTop: 8, textAlign: 'center' }}>Show this to the seller — don't text it.</Text>
              </Card>
            )}
            {deal.state === 'AT_MEETUP' && role === 'seller' && (
              <View style={{ marginTop: 14 }}>
                <TextInput value={code} onChangeText={setCode} placeholder="release code" keyboardType="number-pad" style={inputStyle(theme)} />
                <Button label="Verify code" iconName="key" onPress={() => act({ type: 'ENTER_CODE', code })} />
              </View>
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
              <View style={{ marginTop: 14 }}>
                <Callout tone={outcome.tone} kicker={outcome.kicker} title={outcome.title} body={outcome.body} />
              </View>
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

            {['AGREED', 'FUNDED', 'ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING', 'DISPUTED'].includes(deal.state) && (
              <View style={{ marginTop: 20 }}>
                <SectionLabel>Chat</SectionLabel>
                <Card padded={false} style={{ padding: 10 }}>
                  {messages.length === 0 ? (
                    <Text style={{ color: theme.colors.textMuted, padding: 6 }}>No messages yet — coordinate your meetup here.</Text>
                  ) : (
                    messages.map((m, i) => {
                      const mine = m.senderId === myId();
                      return (
                        <View key={i} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', backgroundColor: mine ? theme.colors.primary : theme.colors.surfaceAlt, borderRadius: theme.radius.md, paddingHorizontal: 12, paddingVertical: 7, marginVertical: 3, maxWidth: '82%' }}>
                          <Text style={{ color: mine ? theme.colors.onPrimary : theme.colors.text }}>{m.body}</Text>
                        </View>
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
              </View>
            )}

            {['DRAFT', 'AGREED', 'FUNDED', 'ARMED', 'EN_ROUTE'].includes(deal.state) && (
              <Button variant="dangerGhost" label={cancelLabel} onPress={cancelDeal} style={{ marginTop: 18 }} />
            )}

            {['ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING'].includes(deal.state) && (
              <Button variant="dangerGhost" iconName="shield" label="Feel unsafe? Leave safely" onPress={leaveSafely} style={{ marginTop: 10 }} />
            )}

            {['ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING'].includes(deal.state) && (
              <Pressable onPress={openDispute} style={{ marginTop: 14 }}>
                <Text style={{ color: theme.colors.danger, textAlign: 'center' }}>Something wrong? Report a problem</Text>
              </Pressable>
            )}

            {['AGREED', 'FUNDED', 'ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING', 'DISPUTED'].includes(deal.state) && (
              <Pressable onPress={reportOrBlock} style={{ marginTop: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name="flag-outline" size={14} color={theme.colors.textMuted} />
                <Text style={{ color: theme.colors.textMuted, textAlign: 'center', marginLeft: 5 }}>Report or block {theirName()}</Text>
              </Pressable>
            )}

            <SectionLabel style={{ marginTop: 22 }}>Money</SectionLabel>
            {transfers.map((t, i) => (
              <Text key={i} style={{ color: theme.colors.textMuted, fontSize: 13 }}>{t.direction} · {t.status} · ${(t.amountCents / 100).toFixed(2)}</Text>
            ))}
            {busy && <ActivityIndicator style={{ marginTop: 12 }} />}
              </>
            );
          })()}
          </Animated.View>
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

// which action(s) the current role can take now (tiny client mirror of dealUx)
function nextActions(deal: Deal, role: Role): Action[] {
  const s = deal.state;
  if (s === 'DRAFT' && role === 'seller') return [{ type: 'ACCEPT_TERMS' }];
  if (s === 'AGREED' && role === 'buyer') return [{ type: 'FUND' }];
  if (s === 'FUNDED' && role === 'seller') return [{ type: 'POST_STAKE' }];
  if (s === 'ARMED') return [{ type: 'HEAD_OUT', actor: role }];
  if (s === 'EN_ROUTE') {
    const arrived = role === 'buyer' ? deal.buyerArrived : deal.sellerArrived;
    return arrived ? [] : [{ type: 'ARRIVE', party: role }];
  }
  if (s === 'AT_MEETUP' && role === 'buyer' && !deal.codeRevealed) return [{ type: 'REVEAL_CODE' }];
  if (s === 'CONFIRMING' && role === 'buyer') return [{ type: 'CONFIRM_RECEIVED' }];
  return [];
}
function labelFor(a: Action, deal: Deal): string {
  switch (a.type) {
    case 'ACCEPT_TERMS': return 'Accept terms';
    case 'FUND': return `Fund ${formatMoney(deal.amountCents + deal.feeCentsPerSide + deal.commitmentCents)}`;
    case 'POST_STAKE': return `Post ${formatMoney(deal.commitmentCents)} commitment`;
    case 'HEAD_OUT': return "I'm heading out";
    case 'ARRIVE': return "I've arrived";
    case 'REVEAL_CODE': return 'Reveal release code';
    case 'CONFIRM_RECEIVED': return "Confirm I've got it";
    default: return a.type;
  }
}
// natural leading icon for a primary action button (presentational only)
function iconFor(a: Action): IconName | undefined {
  switch (a.type) {
    case 'ACCEPT_TERMS': return 'checkmark-circle';
    case 'FUND': return 'lock-closed';
    case 'POST_STAKE': return 'lock-closed';
    case 'HEAD_OUT': return 'walk';
    case 'ARRIVE': return 'location';
    case 'REVEAL_CODE': return 'key';
    case 'CONFIRM_RECEIVED': return 'checkmark';
    default: return undefined;
  }
}
// friendly one-liner shown as a banner when the deal moves to a new state
function stateBanner(s: string): string {
  const m: Record<string, string> = {
    AGREED: 'Terms accepted — the buyer can fund.',
    FUNDED: 'Funded — the seller can post their commitment.',
    ARMED: 'Both staked — head to the meetup.',
    EN_ROUTE: 'On the way — share your location to meet up.',
    AT_MEETUP: 'You are both here — reveal and enter the code.',
    CONFIRMING: 'Code verified — the buyer confirms receipt.',
    RELEASED: 'Done — funds released.',
    REFUNDED: 'Refunded.',
    CANCELLED: 'Cancelled.',
    EXPIRED_NO_SHOW: 'Expired — someone did not show.',
  };
  return m[s] ?? `Now: ${s}`;
}

const FUNDED_STATES = ['FUNDED', 'ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING'];

// deal state → Stepper index (terminal failure states are intentionally absent:
// the Stepper is hidden for them and the outcome Callout tells the story instead)
const STEP_INDEX: Record<string, number> = {
  DRAFT: 0,
  AGREED: 1,
  FUNDED: 2,
  ARMED: 3,
  EN_ROUTE: 3,
  AT_MEETUP: 3,
  CONFIRMING: 3,
  RELEASED: 4,
  DISPUTE_RESOLVED: 4,
};

// presence status line for the PresenceCard rows
const presenceStatus = (arrived: boolean, headedOut: boolean, distanceM: number | null): string =>
  arrived ? 'arrived' : headedOut ? (distanceM != null ? `${distanceM} m away` : 'heading over') : 'not left yet';

// Whose move is it, and why it's safe — powers the guidance Callout on the deal screen.
function turnGuidance(deal: Deal, role: Role, otherFirst: string, demoHint: string | null): { tone: Tone; kicker: string; title: string; body: string } | null {
  const s = deal.state;
  if (!['DRAFT', 'AGREED', 'FUNDED', 'ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING'].includes(s)) return null;
  const myTurn = nextActions(deal, role).length > 0 || (s === 'AT_MEETUP' && role === 'seller');
  if (myTurn) {
    let title = 'Your move';
    let body = '';
    if (s === 'DRAFT') { title = 'Review and accept the terms'; body = 'Nothing is charged until the buyer funds the escrow.'; }
    else if (s === 'AGREED') { title = 'Fund the escrow'; body = `${formatMoney(deal.amountCents)} item + ${formatMoney(deal.feeCentsPerSide)} fee + ${formatMoney(deal.commitmentCents)} refundable commitment. MeetMe holds it all — the seller is only paid after you confirm the handoff.`; }
    else if (s === 'FUNDED') { title = 'Post your commitment'; body = 'A small refundable stake that keeps both sides serious about showing up.'; }
    else if (s === 'ARMED') { title = "Head out when you're ready"; body = 'Funds are locked in escrow — nothing moves until the handoff.'; }
    else if (s === 'EN_ROUTE') { title = 'Tap arrive when you get there'; body = 'Share your live location on the way so you can find each other.'; }
    else if (s === 'AT_MEETUP' && role === 'buyer') { title = 'Reveal the release code'; body = 'Check the item first — the code is what releases the money.'; }
    else if (s === 'AT_MEETUP' && role === 'seller') { title = 'Enter the code the buyer shows you'; body = 'The code confirms the buyer is releasing the payment.'; }
    else if (s === 'CONFIRMING') { title = 'Confirm you got the item'; body = "This releases the payment to the seller — confirm only once it's in your hands."; }
    return { tone: 'primary', kicker: 'Your turn', title, body };
  }
  let body = "Hang tight — you're covered by escrow either way.";
  if (s === 'DRAFT') body = 'They need to accept the terms. Nothing has been charged yet.';
  else if (s === 'AGREED') body = "They're funding the escrow — you'll see it locked here the moment it lands.";
  else if (s === 'FUNDED') body = `Your money is already locked safely in escrow. ${otherFirst} just needs to post their commitment.`;
  else if (s === 'EN_ROUTE') body = "You've arrived — wait somewhere public until they get there.";
  else if (s === 'AT_MEETUP') body = 'Show them the code below. Nothing moves until you confirm you got the item.';
  else if (s === 'CONFIRMING') body = "Code verified — hand over the item now. If they don't confirm, funds auto-release within 60 minutes; you're protected.";
  return { tone: 'neutral', kicker: 'Waiting', title: `Waiting on ${otherFirst}`, body: demoHint ? `${body} ${demoHint}` : body };
}

// What concretely happened to the money — the terminal-state outcome Callout.
function outcomeFor(deal: Deal, role: Role, otherFirst: string): { tone: Tone; kicker: string; title: string; body: string } | null {
  const total = formatMoney(deal.amountCents + deal.feeCentsPerSide + deal.commitmentCents);
  const price = formatMoney(deal.amountCents);
  const commit = formatMoney(deal.commitmentCents);
  switch (deal.state) {
    case 'RELEASED':
      return role === 'buyer'
        ? { tone: 'success', kicker: 'Deal complete', title: 'Payment released', body: `You paid ${total}. ${price} went to the seller and your ${commit} commitment came back.` }
        : { tone: 'success', kicker: 'Deal complete', title: 'You got paid', body: `${price} is on its way to you, and your ${commit} commitment came back.` };
    case 'DISPUTE_RESOLVED':
      return { tone: 'success', kicker: 'Resolved', title: 'Dispute resolved', body: deal.resolutionNote || 'A specialist reviewed the case and settled the funds.' };
    case 'REFUNDED':
      return role === 'buyer'
        ? { tone: 'neutral', kicker: 'Refunded', title: 'You got everything back', body: `${total} was returned to you in full.` }
        : { tone: 'neutral', kicker: 'Refunded', title: 'Deal refunded', body: `The buyer was refunded and your ${commit} commitment came back. No money changed hands.` };
    case 'CANCELLED':
      return { tone: 'neutral', kicker: 'Cancelled', title: 'Deal cancelled', body: 'Anything already funded was returned in full.' };
    case 'EXPIRED_NO_SHOW': {
      const iArrived = role === 'buyer' ? deal.buyerArrived : deal.sellerArrived;
      const theyArrived = role === 'buyer' ? deal.sellerArrived : deal.buyerArrived;
      const body = iArrived && !theyArrived
        ? `${otherFirst} didn't show. You were refunded in full, and their ${commit} commitment was forfeited.`
        : !iArrived && theyArrived
          ? `You didn't make it, so your ${commit} commitment was forfeited. Everything else was returned.`
          : `Nobody made it to the meetup. Commitments were forfeited and the rest was returned.`;
      return { tone: 'warning', kicker: 'No-show', title: 'Deal expired', body };
    }
  }
  return null;
}

// Trust explainer — how escrow protects both sides. Opened from the TrustBanner.
function TrustModal({ visible, amount, onClose }: { visible: boolean; amount: number; onClose: () => void }) {
  const theme = useTheme();
  const rows: Array<[IconName, string, string]> = [
    ['lock-closed', 'Held in escrow', `Your ${amount ? formatMoney(amount) : 'payment'} is held by MeetMe — never sent to the other person up front.`],
    ['cash-outline', 'Released only on handoff', 'The seller is paid only after you confirm you got the item, using a one-time release code.'],
    ['shield-checkmark', 'No-show protection', 'If the other person never shows, you are fully refunded — and their $5 commitment is forfeited.'],
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

const STATE_LABEL: Record<string, string> = {
  DRAFT: 'Draft', AGREED: 'Agreed', FUNDED: 'Funded', ARMED: 'Ready', EN_ROUTE: 'On the way',
  AT_MEETUP: 'At meetup', CONFIRMING: 'Confirming', RELEASED: 'Completed', CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded', EXPIRED_NO_SHOW: 'No-show', DISPUTED: 'Disputed', DISPUTE_RESOLVED: 'Resolved',
};

// Counterparty reputation card: trust signals + your shared history with them.
function ProfileModal({ visible, loading, profile, onClose, onReportBlock }: {
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
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ---- tiny UI bits ----
const inputStyle = (theme: Theme) => ({ backgroundColor: theme.colors.surface, borderWidth: 1.5, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: theme.spacing.md, fontSize: theme.type.size.md, marginBottom: theme.spacing.sm } as const);
function RolePick({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={{ flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1.5, borderColor: active ? theme.colors.primary : theme.colors.border, backgroundColor: active ? theme.colors.successSoft : theme.colors.surface }}>
      <Text style={{ textAlign: 'center', color: active ? theme.colors.primary : theme.colors.textDim, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}
function RoleBar({ viewAs, users, onToggle }: { viewAs: Role; users: DemoUsers; onToggle: () => void }) {
  const theme = useTheme();
  const me = viewAs === 'buyer' ? users.buyer : users.seller;
  const other = viewAs === 'buyer' ? users.seller : users.buyer;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: theme.colors.text, borderRadius: 10, padding: 10, marginBottom: 12 }}>
      <Text style={{ color: theme.colors.surface }}>Viewing as <Text style={{ fontWeight: '800' }}>{me.name} ({viewAs})</Text></Text>
      <Pressable onPress={onToggle} style={{ backgroundColor: theme.colors.primary, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 }}>
        <Text style={{ color: theme.colors.onPrimary, fontSize: 12 }}>View as {other.name.split(' ')[0]} ⇄</Text>
      </Pressable>
    </View>
  );
}

// Dev switch: render the UI-kit gallery instead of the app (design review only).
const SHOW_UI_GALLERY = false;

export default function App() {
  return (
    <ThemeProvider>
      {SHOW_UI_GALLERY ? <UIGallery /> : <AppRoot />}
    </ThemeProvider>
  );
}
