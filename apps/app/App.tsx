import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Image, KeyboardAvoidingView, LayoutAnimation, Linking, Modal, Platform, Pressable, SafeAreaView, ScrollView, Text, TextInput, UIManager, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Swipeable } from 'react-native-gesture-handler';
import { api, type Action, type Deal, type Invite, type MeetupSpot, type Role, type Transfer, type UserProfile } from './src/api';
import { supabase } from './src/supabase';
import { registerForPush } from './src/push';

// Two modes:
//  • Real login — phone OTP (Supabase Auth). One identity per device; live updates
//    over Supabase Realtime; push notifications.
//  • Demo mode — one device drives BOTH parties via a "Viewing as" toggle (dev
//    login, polling). Handy for testing without two phones.
type Phase = 'login' | 'home' | 'deal';
interface Session { userId: string; name: string; accessToken: string }
interface DemoUsers { buyer: { id: string; name: string }; seller: { id: string; name: string } }
const GREEN = '#2f6f5e';
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

export default function App() {
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
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7f9' }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={{ fontSize: 30, fontWeight: '800', color: GREEN }}>MeetMe</Text>
        <Text style={{ color: '#555', marginBottom: 22 }}>Sign in with your phone</Text>
        <TextInput value={name} onChangeText={setName} placeholder="Your name" style={input} />
        <TextInput value={phone} onChangeText={(t) => setPhone(formatPhone(t))} placeholder="555-123-4567" keyboardType="phone-pad" maxLength={12} style={input} />
        {!otpSent ? (
          <Btn label="Send code" onPress={sendCode} />
        ) : (
          <>
            <TextInput value={otp} onChangeText={setOtp} placeholder="6-digit code (local: 123456)" keyboardType="number-pad" style={input} />
            <Btn label="Verify & continue" onPress={verifyCode} />
            <Pressable onPress={() => setOtpSent(false)}><Text style={{ color: GREEN, textAlign: 'center', marginTop: 4 }}>Use a different number</Text></Pressable>
          </>
        )}
        <Text style={{ color: '#93a1ab', textAlign: 'center', marginVertical: 18 }}>— or —</Text>
        <Pressable onPress={startDemo} style={{ borderColor: GREEN, borderWidth: 1.5, padding: 14, borderRadius: 12 }}>
          <Text style={{ color: GREEN, textAlign: 'center', fontWeight: '700' }}>Demo mode (Maya & Sam on one device)</Text>
        </Pressable>
        {busy && <ActivityIndicator style={{ marginTop: 16 }} />}
        {!!err && <Text style={{ color: '#b3382a', marginTop: 12 }}>{err}</Text>}
      </ScrollView>
      </KeyboardAvoidingView>
      </SafeAreaView>
    );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7f9' }}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: 34 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {session ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#14181b', borderRadius: 10, padding: 10, marginBottom: 12 }}>
              <Text style={{ color: '#fff' }}>Signed in as <Text style={{ fontWeight: '800' }}>{session.name}</Text></Text>
              <Pressable onPress={logout}><Text style={{ color: '#f0a', fontSize: 12 }}>Log out</Text></Pressable>
            </View>
          ) : (
            <RoleBar viewAs={viewAs} users={demo!} onToggle={() => setViewAs((r) => (r === 'buyer' ? 'seller' : 'buyer'))} />
          )}

          <Animated.View style={{ opacity: screenFade }}>
          {!!banner && (
            <Pressable onPress={() => setBanner('')} style={{ backgroundColor: '#e7f3ee', borderColor: GREEN, borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 10 }}>
              <Text style={{ color: GREEN, fontWeight: '600' }}>{banner}</Text>
            </Pressable>
          )}
          {!!err && <Text style={{ color: '#b3382a', marginVertical: 8 }}>{err}</Text>}

          {phase === 'home' && (
            <>
          {session && invites.length > 0 && (
            <>
              <Text style={sectionLabel}>Invites for you</Text>
              {invites.map((iv) => (
                <View key={iv.token} style={card}>
                  <Text style={{ fontWeight: '600' }}>{iv.inviterName} invited you</Text>
                  <Text style={{ color: '#6b7882' }}>{iv.itemDescription} · {formatMoney(iv.amountCents)}</Text>
                  <Text style={{ color: GREEN, marginBottom: 8, fontSize: 13 }}>You'll be the {iv.yourRole}</Text>
                  <Btn label="Accept" onPress={() => acceptInvite(iv.token)} />
                  <Pressable onPress={() => declineInvite(iv.token)}><Text style={{ color: '#b3382a', textAlign: 'center' }}>Decline</Text></Pressable>
                </View>
              ))}
            </>
          )}

          <Text style={sectionLabel}>{session ? 'Invite someone to a deal' : 'New deal'}</Text>
          <TextInput value={item} onChangeText={setItem} placeholder="Item (e.g. iPhone 12, 128GB)" style={input} />
          <TextInput value={amountCents ? formatMoney(amountCents) : ''} onChangeText={(t) => setAmountCents(centsFromInput(t))} placeholder="$0.00" keyboardType="number-pad" style={input} />
          {session ? (
            <>
              <TextInput value={cpPhone} onChangeText={(t) => setCpPhone(formatPhone(t))} placeholder="555-123-4567" keyboardType="phone-pad" maxLength={12} style={input} />
              <View style={{ flexDirection: 'row', marginBottom: 8 }}>
                <RolePick label="I'm buying" active={inviteRole === 'buyer'} onPress={() => setInviteRole('buyer')} />
                <View style={{ width: 8 }} />
                <RolePick label="I'm selling" active={inviteRole === 'seller'} onPress={() => setInviteRole('seller')} />
              </View>
              <Btn label={inviteValid() ? `Send invite (${formatMoney(amountCents)})` : 'Send invite'} disabled={!inviteValid()} onPress={inviteSomeone} />
            </>
          ) : (
            <Btn label={dealValid() ? `Create deal (${formatMoney(amountCents)})` : 'Create deal'} disabled={!dealValid()} onPress={newDeal} />
          )}

          <Text style={sectionLabel}>Your deals</Text>
          {deals.map((d) => {
            const row = (
              <Pressable onPress={() => openDeal(d.id)} style={card}>
                <Text style={{ fontWeight: '600' }}>{d.itemDescription}</Text>
                <Text style={{ color: '#6b7882' }}>{formatMoney(d.amountCents)} · {d.state}</Text>
              </Pressable>
            );
            if (d.state !== 'DRAFT') return <View key={d.id}>{row}</View>;
            return (
              <Swipeable
                key={d.id}
                renderRightActions={() => (
                  <Pressable onPress={() => deleteDraft(d.id)} style={{ backgroundColor: '#b3382a', justifyContent: 'center', paddingHorizontal: 22, borderRadius: 12, marginBottom: 10 }}>
                    <Text style={{ color: '#fff', fontWeight: '700' }}>Delete</Text>
                  </Pressable>
                )}
              >
                {row}
              </Swipeable>
            );
          })}
          {deals.length === 0 && <Text style={{ color: '#93a1ab' }}>No deals yet.</Text>}
          {session && <Text style={{ color: '#93a1ab', fontSize: 12, marginTop: 10 }}>Tip: swipe a draft deal left to delete it.</Text>}
            </>
          )}

          {phase === 'deal' && deal && (
            <>
          <Pressable onPress={() => setPhase('home')}><Text style={{ color: GREEN, marginBottom: 8 }}>← My deals</Text></Pressable>
          <Text style={{ fontSize: 22, fontWeight: '800' }}>{deal.itemDescription}</Text>
          <Text style={{ color: '#6b7882', marginBottom: 6 }}>{formatMoney(deal.amountCents)} · {deal.state}</Text>

          {(() => {
            const other: Role = myRole(deal) === 'buyer' ? 'seller' : 'buyer';
            const oName = other === 'buyer' ? names.buyer : names.seller;
            const oTrust = other === 'buyer' ? rep.buyerTrust : rep.sellerTrust;
            const oDeals = other === 'buyer' ? rep.buyerDeals : rep.sellerDeals;
            return (
              <Pressable onPress={openProfile} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }} hitSlop={8}>
                <Ionicons name="star" size={14} color="#f4b400" />
                <Text style={{ color: '#6b7882', marginLeft: 5 }}>{oName} · trust {oTrust ?? '—'}/100 · {oDeals} deal{oDeals === 1 ? '' : 's'}</Text>
                <Ionicons name="chevron-forward" size={14} color="#93a1ab" style={{ marginLeft: 2 }} />
              </Pressable>
            );
          })()}

          <TrustBanner amount={deal.amountCents} state={deal.state} role={myRole(deal)} onPress={() => setShowTrust(true)} />

          {(() => {
            const canSet = ['DRAFT', 'AGREED', 'FUNDED', 'ARMED'].includes(deal.state);
            if (deal.meetupName) {
              return (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: deal.meetupCustom ? '#f0c9c3' : '#cfe6dc', borderRadius: 12, padding: 12, marginBottom: 12 }}>
                  <Ionicons name="location" size={20} color={deal.meetupCustom ? '#b3382a' : GREEN} />
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={{ fontWeight: '700' }} numberOfLines={1}>{deal.meetupName}</Text>
                    <Text style={{ color: deal.meetupCustom ? '#b3382a' : GREEN, fontSize: 12 }}>{deal.meetupCustom ? 'Custom spot — not verified' : 'Safe public spot'}</Text>
                  </View>
                  {canSet && <Pressable onPress={openMeetup} hitSlop={8}><Text style={{ color: GREEN, fontWeight: '600' }}>Change</Text></Pressable>}
                </View>
              );
            }
            return canSet ? <Btn label="Set a safe meeting spot" onPress={openMeetup} /> : null;
          })()}

          {nextActions(deal, myRole(deal)).map((a, i) => (
            <Btn key={i} label={labelFor(a, deal)} onPress={() => act(a)} />
          ))}

          {(deal.state === 'EN_ROUTE' || deal.state === 'AT_MEETUP') && (
            mapUrl ? (
              <View style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 12, backgroundColor: '#eef5f1' }}>
                <Image source={{ uri: mapUrl }} style={{ width: '100%', height: 200 }} resizeMode="cover" />
                <View style={{ position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: GREEN, marginRight: 5 }} />
                  <Text style={{ color: GREEN, fontWeight: '700', fontSize: 12 }}>LIVE</Text>
                </View>
                <View style={{ padding: 10 }}>
                  <Text style={{ color: '#444' }}>{names.buyer.split(' ')[0]}: <Text style={{ fontWeight: '700' }}>{presenceLabel(deal.buyerArrived, deal.buyerHeadedOut)}</Text>  ·  {names.seller.split(' ')[0]}: <Text style={{ fontWeight: '700' }}>{presenceLabel(deal.sellerArrived, deal.sellerHeadedOut)}</Text></Text>
                  {geo?.distanceM != null && <Text style={{ color: '#6b7882', marginTop: 2 }}>{geo.distanceM} m apart</Text>}
                </View>
              </View>
            ) : (
              <PresenceMap deal={deal} myRole={myRole(deal)} names={names} distanceM={geo?.distanceM ?? null} />
            )
          )}
          {deal.state === 'EN_ROUTE' && (
            <>
              <Btn label="Share my location" onPress={shareLocation} />
              {geo && !geo.coLocated && geo.distanceM != null && (
                <Text style={{ color: '#6b7882', marginBottom: 4 }}>{geo.distanceM} m apart — keep going.</Text>
              )}
            </>
          )}

          {deal.state === 'AT_MEETUP' && myRole(deal) === 'buyer' && deal.codeRevealed && (
            <Text style={{ fontSize: 32, fontWeight: '800', letterSpacing: 6, color: GREEN, marginVertical: 12 }}>{code || '••••'}</Text>
          )}
          {deal.state === 'AT_MEETUP' && myRole(deal) === 'seller' && (
            <View style={{ marginVertical: 8 }}>
              <TextInput value={code} onChangeText={setCode} placeholder="release code" keyboardType="number-pad" style={input} />
              <Btn label="Enter code" onPress={() => act({ type: 'ENTER_CODE', code })} />
            </View>
          )}

          {!nextActions(deal, myRole(deal)).length && deal.state !== 'AT_MEETUP' && deal.state !== 'EN_ROUTE' && (
            <Text style={{ color: '#6b7882', marginVertical: 8 }}>
              {session ? `Waiting on the other party…` : `Waiting on ${otherName()} — tap "View as ${otherName().split(' ')[0]}" above.`}
            </Text>
          )}

          {['DRAFT', 'AGREED', 'FUNDED', 'ARMED', 'EN_ROUTE'].includes(deal.state) && (
            <Pressable onPress={cancelDeal} style={{ marginTop: 10 }}>
              <Text style={{ color: '#b3382a', textAlign: 'center' }}>
                {deal.state === 'EN_ROUTE' ? 'Back out (forfeits your commitment)' : 'Cancel this deal (full refund)'}
              </Text>
            </Pressable>
          )}

          {['ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING'].includes(deal.state) && (
            <Pressable onPress={openDispute} style={{ marginTop: 10 }}>
              <Text style={{ color: '#b3382a', textAlign: 'center' }}>Something wrong? Report a problem</Text>
            </Pressable>
          )}

          {['AGREED', 'FUNDED', 'ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING', 'DISPUTED'].includes(deal.state) && (
            <Pressable onPress={reportOrBlock} style={{ marginTop: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name="flag-outline" size={14} color="#93a1ab" />
              <Text style={{ color: '#93a1ab', textAlign: 'center', marginLeft: 5 }}>Report or block {theirName()}</Text>
            </Pressable>
          )}

          {['ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING'].includes(deal.state) && (
            <Pressable
              onPress={leaveSafely}
              style={{ marginTop: 16, borderWidth: 1, borderColor: '#f0c9c4', backgroundColor: '#fdf3f2', borderRadius: 12, paddingVertical: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}
            >
              <Ionicons name="shield-outline" size={16} color="#b3382a" />
              <Text style={{ color: '#b3382a', fontWeight: '700', marginLeft: 6 }}>Feel unsafe? Leave safely</Text>
            </Pressable>
          )}

          {deal.state === 'DISPUTED' && (
            <View style={{ backgroundColor: '#fdecea', borderColor: '#b3382a', borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 12 }}>
              <Text style={{ fontWeight: '800', color: '#b3382a', marginBottom: 4 }}>Dispute open — funds frozen</Text>
              <Text style={{ color: '#7a2a22', marginBottom: 10 }}>Both sides explain what happened; a MeetMe specialist reviews and decides.</Text>
              {deal.disputePositions.map((p, i) => (
                <Text key={i} style={{ color: '#444', marginBottom: 6 }}><Text style={{ fontWeight: '700' }}>{p.actor}:</Text> {p.text}</Text>
              ))}
              <TextInput value={statement} onChangeText={setStatement} placeholder="Your account of what happened" multiline style={[input, { minHeight: 60 }]} />
              <Btn label="Submit statement" disabled={!statement.trim()} onPress={submitStatement} />

              <Text style={{ color: '#7a2a22', fontWeight: '700', marginTop: 6 }}>Agree on a resolution</Text>
              <Text style={{ color: '#7a2a22', fontSize: 12, marginBottom: 6 }}>
                You: {deal.disputeProposals[myRole(deal)] ?? '—'} · Them: {deal.disputeProposals[myRole(deal) === 'buyer' ? 'seller' : 'buyer'] ?? '—'} — if you both pick the same, it resolves instantly.
              </Text>
              <View style={{ flexDirection: 'row', marginBottom: 10 }}>
                <RolePick label="Release" active={deal.disputeProposals[myRole(deal)] === 'release'} onPress={() => propose('release')} />
                <View style={{ width: 6 }} />
                <RolePick label="Refund" active={deal.disputeProposals[myRole(deal)] === 'refund'} onPress={() => propose('refund')} />
                <View style={{ width: 6 }} />
                <RolePick label="Split" active={deal.disputeProposals[myRole(deal)] === 'split'} onPress={() => propose('split')} />
              </View>

              <Text style={{ color: '#93a1ab', fontSize: 12, marginTop: 4, marginBottom: 6 }}>Or a specialist decides (demo — admin/support console):</Text>
              <View style={{ flexDirection: 'row' }}>
                <RolePick label="Release" active={false} onPress={() => resolveDispute('release')} />
                <View style={{ width: 6 }} />
                <RolePick label="Refund" active={false} onPress={() => resolveDispute('refund')} />
                <View style={{ width: 6 }} />
                <RolePick label="Split" active={false} onPress={() => resolveDispute('split')} />
              </View>
            </View>
          )}

          {deal.state === 'DISPUTE_RESOLVED' && !!deal.resolutionNote && (
            <View style={{ backgroundColor: '#e7f3ee', borderRadius: 12, padding: 14, marginTop: 12 }}>
              <Text style={{ fontWeight: '700', color: GREEN }}>Dispute resolved</Text>
              <Text style={{ color: '#444' }}>{deal.resolutionNote}</Text>
            </View>
          )}

          {(deal.state === 'RELEASED' || deal.state === 'DISPUTE_RESOLVED') && (
            <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: '#e3e8ec' }}>
              {deal.ratings[myRole(deal)] !== undefined ? (
                <Text style={{ color: '#6b7882' }}>You rated {deal.ratings[myRole(deal)]}★ — thanks for the feedback!</Text>
              ) : (
                <>
                  <Text style={{ fontWeight: '700', marginBottom: 8 }}>Rate your experience</Text>
                  <StarPicker onPick={rate} />
                </>
              )}
            </View>
          )}

          {['AGREED', 'FUNDED', 'ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING', 'DISPUTED'].includes(deal.state) && (
            <View style={{ marginTop: 18 }}>
              <Text style={{ marginBottom: 6, color: '#6b7882', fontWeight: '600' }}>Chat</Text>
              <View style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3e8ec', borderRadius: 12, padding: 10 }}>
                {messages.length === 0 ? (
                  <Text style={{ color: '#93a1ab', padding: 6 }}>No messages yet — coordinate your meetup here.</Text>
                ) : (
                  messages.map((m, i) => {
                    const mine = m.senderId === myId();
                    return (
                      <View key={i} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', backgroundColor: mine ? GREEN : '#eef1f3', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7, marginVertical: 3, maxWidth: '82%' }}>
                        <Text style={{ color: mine ? '#fff' : '#14181b' }}>{m.body}</Text>
                      </View>
                    );
                  })
                )}
              </View>
              <View style={{ flexDirection: 'row', marginTop: 8 }}>
                <TextInput value={msgInput} onChangeText={setMsgInput} placeholder="Message…" style={[input, { flex: 1, marginBottom: 0 }]} onSubmitEditing={sendMessage} returnKeyType="send" />
                <Pressable onPress={sendMessage} style={{ backgroundColor: GREEN, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center', marginLeft: 8 }} hitSlop={4}>
                  <Ionicons name="send" size={18} color="#fff" />
                </Pressable>
              </View>
            </View>
          )}

          <Text style={{ marginTop: 18, marginBottom: 6, color: '#6b7882', fontWeight: '600' }}>Money</Text>
          {transfers.map((t, i) => (
            <Text key={i} style={{ color: '#444' }}>{t.direction} · {t.status} · ${(t.amountCents / 100).toFixed(2)}</Text>
          ))}
          {busy && <ActivityIndicator style={{ marginTop: 12 }} />}
            </>
          )}
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
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 22, paddingBottom: 30, maxHeight: '88%' }}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={{ fontSize: 22, fontWeight: '800', marginBottom: 4 }}>Find a fair meeting spot</Text>
              <Text style={{ color: '#6b7882', marginBottom: 14 }}>Safe public spots roughly halfway — balanced by drive time for both of you. Enter where you're coming from (this is only used to find the midpoint).</Text>
              <TextInput value={comingFrom} onChangeText={setComingFrom} placeholder="Your starting area or address" style={input} />
              <Btn label="Find spots from this address" onPress={shareFromAddress} />
              <Pressable onPress={shareFromCurrentLocation} style={{ marginBottom: 8 }}><Text style={{ color: GREEN, textAlign: 'center', fontWeight: '600' }}>Or use my current location</Text></Pressable>
              {!!meetupMsg && <Text style={{ color: '#6b7882', marginBottom: 10 }}>{meetupMsg}</Text>}
              {deal && suggestions.map((s, i) => {
                const mine = myRole(deal) === 'buyer' ? s.minutesBuyer : s.minutesSeller;
                const theirs = myRole(deal) === 'buyer' ? s.minutesSeller : s.minutesBuyer;
                return (
                  <Pressable key={i} onPress={() => chooseMeetup(s)} style={[card, { flexDirection: 'row', alignItems: 'center' }]}>
                    <Ionicons name={s.tier === 'verified' ? 'shield-checkmark' : 'business'} size={20} color={s.tier === 'verified' ? GREEN : '#6b7882'} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ fontWeight: '600' }} numberOfLines={1}>{s.name}</Text>
                      <Text style={{ color: '#6b7882', fontSize: 12 }}>{s.tier === 'verified' ? 'Verified · ' : s.category + ' · '}{mine != null ? `you ${mine}m` : '—'} · {theirs != null ? `them ${theirs}m` : '—'}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#b9c6c0" />
                  </Pressable>
                );
              })}
              <View style={{ height: 1, backgroundColor: '#eef3f0', marginVertical: 14 }} />
              <Text style={{ fontWeight: '700', marginBottom: 4 }}>Custom spot</Text>
              <Text style={{ color: '#6b7882', fontSize: 12, marginBottom: 8 }}>Pick your own place — but it won't be a verified safe location.</Text>
              <TextInput value={customSpot} onChangeText={setCustomSpot} placeholder="Custom address" style={input} />
              <Btn label="Use a custom spot" onPress={useCustomSpot} />
              <Pressable onPress={() => setMeetupOpen(false)} style={{ marginTop: 4 }}><Text style={{ color: '#6b7882', textAlign: 'center' }}>Close</Text></Pressable>
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
    case 'FUND': return `Fund $${(deal.amountCents / 100).toFixed(0)} + $5 commitment`;
    case 'POST_STAKE': return 'Post $5 commitment';
    case 'HEAD_OUT': return "I'm heading out";
    case 'ARRIVE': return "I've arrived";
    case 'REVEAL_CODE': return 'Reveal release code';
    case 'CONFIRM_RECEIVED': return "Confirm I've got it";
    default: return a.type;
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

const initials = (name: string): string =>
  name.trim().split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';
const presenceLabel = (arrived: boolean, headedOut: boolean): string =>
  arrived ? 'arrived' : headedOut ? 'heading over' : 'not left';
const FUNDED_STATES = ['FUNDED', 'ARMED', 'EN_ROUTE', 'AT_MEETUP', 'CONFIRMING'];

// Trust reassurance line on the deal screen — tap for the "how it works" explainer.
function TrustBanner({ amount, state, role, onPress }: { amount: number; state: string; role: Role; onPress: () => void }) {
  const funded = FUNDED_STATES.includes(state);
  const text = !funded
    ? 'Funds are held safely in escrow until handoff'
    : role === 'buyer'
      ? `Your ${formatMoney(amount)} is safe in escrow`
      : `The buyer's ${formatMoney(amount)} is secured in escrow`;
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#e7f3ee', borderRadius: 10, padding: 12, marginBottom: 12 }}>
      <Ionicons name="shield-checkmark" size={20} color={GREEN} />
      <Text style={{ color: GREEN, fontWeight: '600', marginLeft: 8, flex: 1 }}>{text}</Text>
      <Text style={{ color: GREEN, fontSize: 12, marginRight: 2 }}>How it works</Text>
      <Ionicons name="chevron-forward" size={16} color={GREEN} />
    </Pressable>
  );
}

function TrustModal({ visible, amount, onClose }: { visible: boolean; amount: number; onClose: () => void }) {
  const rows: Array<[keyof typeof Ionicons.glyphMap, string, string]> = [
    ['lock-closed', 'Held in escrow', `Your ${amount ? formatMoney(amount) : 'payment'} is held by MeetMe — never sent to the other person up front.`],
    ['cash-outline', 'Released only on handoff', 'The seller is paid only after you confirm you got the item, using a one-time release code.'],
    ['shield-checkmark', 'No-show protection', 'If the other person never shows, you are fully refunded — and their $5 commitment is forfeited.'],
    ['arrow-undo', 'Refundable', 'Cancel before the handoff and everything comes back to you.'],
  ];
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 22, paddingBottom: 40 }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: '#14181b', marginBottom: 4 }}>How your money stays safe</Text>
          <Text style={{ color: '#6b7882', marginBottom: 18 }}>MeetMe holds the payment in escrow, so neither side can be scammed.</Text>
          {rows.map(([icon, title, body]) => (
            <View key={title} style={{ flexDirection: 'row', marginBottom: 16 }}>
              <Ionicons name={icon} size={22} color={GREEN} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ fontWeight: '700', color: '#14181b' }}>{title}</Text>
                <Text style={{ color: '#6b7882' }}>{body}</Text>
              </View>
            </View>
          ))}
          <Btn label="Got it" onPress={onClose} />
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
  const trust = profile?.trustScore ?? 0;
  const trustColor = trust >= 70 ? GREEN : trust >= 40 ? '#d68a00' : '#b3382a';
  const initial = (profile?.name ?? '?').trim().charAt(0).toUpperCase();
  const year = profile?.memberSince ? new Date(profile.memberSince).getFullYear() : null;
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 22, paddingBottom: 34, maxHeight: '86%' }}>
          {loading || !profile ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <ActivityIndicator color={GREEN} />
              <Text style={{ color: '#93a1ab', marginTop: 10 }}>Loading profile…</Text>
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: profile.avatarColor, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>{initial}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={{ fontSize: 20, fontWeight: '800', color: '#14181b' }}>{profile.name}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                    <Ionicons name={profile.idVerified ? 'shield-checkmark' : 'call'} size={13} color={profile.idVerified ? GREEN : '#93a1ab'} />
                    <Text style={{ color: profile.idVerified ? GREEN : '#93a1ab', fontSize: 12, marginLeft: 4 }}>
                      {profile.idVerified ? 'ID verified' : 'Phone verified'}{year ? ` · Member since ${year}` : ''}
                    </Text>
                  </View>
                </View>
              </View>

              {profile.blocked && (
                <View style={{ backgroundColor: '#fdecea', borderRadius: 10, padding: 10, marginBottom: 14, flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="ban" size={15} color="#b3382a" />
                  <Text style={{ color: '#b3382a', marginLeft: 6, fontWeight: '600' }}>You've blocked this person.</Text>
                </View>
              )}

              {/* trust score */}
              <Text style={{ fontWeight: '700', color: '#14181b', marginBottom: 6 }}>Trust score</Text>
              <View style={{ height: 10, borderRadius: 5, backgroundColor: '#eef2f4', overflow: 'hidden', marginBottom: 4 }}>
                <View style={{ width: `${Math.max(4, Math.min(100, trust))}%`, height: 10, backgroundColor: trustColor }} />
              </View>
              <Text style={{ color: '#6b7882', fontSize: 12, marginBottom: 16 }}>
                {trust}/100 · {profile.completedDeals} completed deal{profile.completedDeals === 1 ? '' : 's'} on MeetMe
              </Text>

              {/* shared history */}
              <Text style={{ fontWeight: '700', color: '#14181b', marginBottom: 8 }}>Your history together</Text>
              {profile.shared.length === 0 ? (
                <Text style={{ color: '#93a1ab', marginBottom: 16 }}>This is your first deal with {profile.name.split(' ')[0]}.</Text>
              ) : (
                profile.shared.map((d) => (
                  <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#eef2f4' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#14181b' }} numberOfLines={1}>{d.itemDescription}</Text>
                      <Text style={{ color: '#93a1ab', fontSize: 12 }}>You were {d.youWere} · {formatMoney(d.amountCents)}</Text>
                    </View>
                    <Text style={{ color: d.state === 'RELEASED' ? GREEN : '#6b7882', fontSize: 12, fontWeight: '600' }}>{STATE_LABEL[d.state] ?? d.state}</Text>
                  </View>
                ))
              )}

              <Pressable onPress={onReportBlock} style={{ marginTop: 18, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name="flag-outline" size={14} color="#b3382a" />
                <Text style={{ color: '#b3382a', marginLeft: 6, fontWeight: '600' }}>Report or block</Text>
              </Pressable>
              <View style={{ height: 12 }} />
              <Btn label="Close" onPress={onClose} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// Stylized live presence card (the map look): both avatars on a route line toward
// the meetup pin, positioned by status. (Real map = react-native-maps later.)
function PresenceMap({ deal, myRole, names, distanceM }: { deal: Deal; myRole: Role; names: { buyer: string; seller: string }; distanceM: number | null }) {
  const prog = (arrived: boolean, headedOut: boolean) => (arrived ? 0.82 : headedOut ? 0.48 : 0.08);
  const label = (mine: boolean, arrived: boolean, headedOut: boolean) =>
    mine ? (distanceM != null ? `${distanceM}m · you` : 'you') : arrived ? 'Arrived' : headedOut ? 'heading over' : 'not left';
  const Dot = ({ p, name, color, mine, arrived, headedOut }: { p: number; name: string; color: string; mine: boolean; arrived: boolean; headedOut: boolean }) => (
    <View style={{ position: 'absolute', top: 30, left: `${p * 100}%`, width: 46, marginLeft: -23, alignItems: 'center' }}>
      <View style={{ position: 'absolute', top: -22, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#e3e8ec' }}>
        <Text style={{ fontSize: 11, color: '#444' }} numberOfLines={1}>{label(mine, arrived, headedOut)}</Text>
      </View>
      <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: color, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' }}>
        <Text style={{ color: '#fff', fontWeight: '800' }}>{initials(name)}</Text>
      </View>
    </View>
  );
  return (
    <View style={{ backgroundColor: '#eef5f1', borderRadius: 16, padding: 16, marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="location" size={18} color={GREEN} />
          <Text style={{ fontWeight: '700', color: '#14181b', marginLeft: 4 }}>Meetup</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: GREEN, marginRight: 5 }} />
          <Text style={{ color: GREEN, fontWeight: '700', fontSize: 12 }}>LIVE</Text>
        </View>
      </View>
      <View style={{ height: 84 }}>
        <View style={{ position: 'absolute', left: 6, right: 30, top: 52, borderBottomWidth: 2, borderColor: '#bcd4c9', borderStyle: 'dashed' }} />
        <View style={{ position: 'absolute', right: 0, top: 40 }}><Ionicons name="location" size={26} color={GREEN} /></View>
        <Dot p={prog(deal.buyerArrived, deal.buyerHeadedOut)} name={names.buyer} color={GREEN} mine={myRole === 'buyer'} arrived={deal.buyerArrived} headedOut={deal.buyerHeadedOut} />
        <Dot p={prog(deal.sellerArrived, deal.sellerHeadedOut)} name={names.seller} color="#3b6fe0" mine={myRole === 'seller'} arrived={deal.sellerArrived} headedOut={deal.sellerHeadedOut} />
      </View>
    </View>
  );
}

// ---- tiny UI bits ----
const card = { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e3e8ec' } as const;
const sectionLabel = { marginTop: 18, marginBottom: 8, color: '#6b7882', fontWeight: '600' } as const;
const input = { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#d8dee3', borderRadius: 10, padding: 12, fontSize: 18, marginBottom: 10 } as const;
function Btn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} style={{ backgroundColor: disabled ? '#a9c3ba' : GREEN, padding: 15, borderRadius: 12, marginBottom: 8 }}>
      <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}
function StarPicker({ onPick }: { onPick: (n: number) => void }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => onPick(n)} style={{ marginRight: 6 }} hitSlop={6}>
          <Ionicons name="star-outline" size={34} color="#f4b400" />
        </Pressable>
      ))}
    </View>
  );
}
function RolePick({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1.5, borderColor: active ? GREEN : '#d8dee3', backgroundColor: active ? '#e7f3ee' : '#fff' }}>
      <Text style={{ textAlign: 'center', color: active ? GREEN : '#6b7882', fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}
function RoleBar({ viewAs, users, onToggle }: { viewAs: Role; users: DemoUsers; onToggle: () => void }) {
  const me = viewAs === 'buyer' ? users.buyer : users.seller;
  const other = viewAs === 'buyer' ? users.seller : users.buyer;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#14181b', borderRadius: 10, padding: 10, marginBottom: 12 }}>
      <Text style={{ color: '#fff' }}>Viewing as <Text style={{ fontWeight: '800' }}>{me.name} ({viewAs})</Text></Text>
      <Pressable onPress={onToggle} style={{ backgroundColor: GREEN, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 }}>
        <Text style={{ color: '#fff', fontSize: 12 }}>View as {other.name.split(' ')[0]} ⇄</Text>
      </Pressable>
    </View>
  );
}
