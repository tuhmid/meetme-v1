// App-wide state + handlers. This is the old single-component AppRoot state,
// lifted into a provider so every screen reads the same source of truth.
//
// Two modes:
//  • Real login — phone OTP (Supabase Auth). One identity per device; live updates
//    over Supabase Realtime; push notifications.
//  • Demo mode — one device drives BOTH parties via a "Viewing as" toggle (dev
//    login, polling). Handy for testing without two phones.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import { api, type Action, type Deal, type Invite, type MeetupSpot, type Role, type Transfer, type UserProfile } from '../api';
import { supabase } from '../supabase';
import { registerForPush } from '../push';
import { formatMoney, gentle, phoneValid, stateBanner, toE164 } from './dealLogic';
import { goDeal, goHome } from './nav';

export interface Session { userId: string; name: string; accessToken: string }
export interface DemoUsers { buyer: { id: string; name: string }; seller: { id: string; name: string } }

function useAppState() {
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
    });

  const logout = () =>
    run(async () => {
      await supabase.auth.signOut();
      setSession(null); setDemo(null); setDeals([]); setDeal(null); setOtpSent(false); setOtp('');
    });

  // ---- deal data ----
  const loadHome = () =>
    run(async () => {
      setDeals((await api.listDeals(bearer())).deals);
      if (session) setInvites((await api.listInvites(session.accessToken)).invites);
    });
  const openDeal = (id: string) => { lastState.current = null; setBanner(''); setGeo(null); setCode(''); setMessages([]); setMsgInput(''); setDealId(id); goDeal(); };
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

  // keep the home lists (deals + incoming invites) fresh without a manual reload
  const pollHome = async () => {
    try {
      setDeals((await api.listDeals(bearer())).deals);
      if (session) setInvites((await api.listInvites(session.accessToken)).invites);
    } catch { /* transient */ }
  };

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
      { text: 'Block', style: 'destructive', onPress: () => run(async () => { await api.blockUser(bearer(), theirId()); Alert.alert('Blocked', `You blocked ${theirName()}.`); goHome(); await loadHome(); }) },
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
        goHome(); await loadHome();
        Alert.alert('You left the deal', frozen
          ? 'Funds are frozen and our safety team is reviewing. If you are in danger, call 911.'
          : 'Reported to our safety team. If you are in danger, call 911.');
      }) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return {
    // identity
    session, demo, viewAs, setViewAs,
    // deal data
    deals, invites, dealId, deal, transfers, code, setCode, banner, setBanner,
    geo, names, rep, mapUrl, messages, msgInput, setMsgInput,
    // modals + inputs
    showTrust, setShowTrust, profile, profileOpen, setProfileOpen, profileLoading,
    statement, setStatement, meetupOpen, setMeetupOpen, comingFrom, setComingFrom,
    customSpot, setCustomSpot, suggestions, meetupMsg,
    // status
    busy, err,
    // login form
    name, setName, phone, setPhone, otp, setOtp, otpSent, setOtpSent, cpPhone, setCpPhone,
    // new-deal form
    item, setItem, amountCents, setAmountCents, inviteRole, setInviteRole, dealValid, inviteValid,
    // identity helpers
    bearer, myId, myRole, otherName,
    // handlers
    sendCode, verifyCode, startDemo, logout,
    loadHome, pollHome, openDeal, loadMessages, sendMessage, newDeal, inviteSomeone,
    acceptInvite, declineInvite, deleteDraft, cancelDeal, propose,
    openMeetup, shareFromCurrentLocation, shareFromAddress, chooseMeetup, useCustomSpot,
    refresh, pullDeal, act, rate, shareLocation,
    openDispute, submitStatement, resolveDispute,
    theirName, openProfile, reportOrBlock, leaveSafely,
  };
}

export type AppValue = ReturnType<typeof useAppState>;

const AppContext = createContext<AppValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const value = useAppState();
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}
