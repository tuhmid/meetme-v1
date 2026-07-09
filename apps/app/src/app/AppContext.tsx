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
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { api, type Action, type ChatMessage, type Deal, type Invite, type MeetupSpot, type Role, type Transfer, type UserProfile } from '../api';
import { supabase, SUPABASE_URL } from '../supabase';
import { consumeInitialNotificationTap, onNotificationTap, registerForPush, type NotificationData } from '../push';
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
  const [proposeTime, setProposeTime] = useState<number | null>(null); // selected meetup time; null = ASAP
  const [suggestions, setSuggestions] = useState<MeetupSpot[]>([]);
  const [meetupMsg, setMeetupMsg] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingImageUri, setPendingImageUri] = useState<string | null>(null); // optimistic image while uploading
  const [msgInput, setMsgInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const lastState = useRef<string | null>(null);
  const coarseLoc = useRef<{ lat: number; lng: number } | null>(null); // primed at onboarding to preload travel times
  const watchRef = useRef<Location.LocationSubscription | null>(null); // live-location stream while heading out
  const suggestedFor = useRef<string | null>(null); // dealId we've already auto-loaded meetup suggestions for

  // login form — blank by default; the user types their own number (demo seeds live in startDemo)
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [cpPhone, setCpPhone] = useState(''); // counterparty (real mode)

  // new-deal / invite form (nothing hardcoded — these drive the amount + item)
  const [item, setItem] = useState('');
  const [amountCents, setAmountCents] = useState(0);
  const [inviteRole, setInviteRoleRaw] = useState<Role>('buyer'); // the inviter's side
  // remember the side they invited as last time, across launches
  useEffect(() => {
    AsyncStorage.getItem('meetme.inviteRole')
      .then((v) => { if (v === 'buyer' || v === 'seller') setInviteRoleRaw(v); })
      .catch(() => {});
  }, []);
  const setInviteRole = (r: Role) => { setInviteRoleRaw(r); AsyncStorage.setItem('meetme.inviteRole', r).catch(() => {}); };
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

  // Seller needs a card on file before their side is sealed — offer to add one and retry.
  const promptAddCard = (retry: () => Promise<void>, depositCents = 500) => {
    const deposit = formatMoney(depositCents);
    Alert.alert(
      'Add a card to continue',
      `You're only ever charged if you don't show up — a ${deposit} hold backs your commitment to the meetup and is released when the deal completes. (Test mode: a fake Visa is used.)`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add card', onPress: () => run(async () => { await api.addPaymentMethod(bearer()); await retry(); }) },
      ]
    );
  };

  // ---- location: prime at onboarding, require it to head out, stream it while en route ----
  // Grab a coarse fix once (permission + last-known) so travel-time suggestions are ready
  // the moment a deal reaches the meetup step — no cold GPS wait mid-deal.
  const primeLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const pos = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
      if (pos) coarseLoc.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch { /* best-effort */ }
  };
  // Per-deal hard gate: you can't head out without live location (that's how arrival auto-detects).
  const ensureLiveLocation = async (): Promise<boolean> => {
    try {
      let { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') ({ status } = await Location.requestForegroundPermissionsAsync());
      return status === 'granted';
    } catch { return false; }
  };
  // Post one live-location ping; if it flipped the deal state (arrived / both here), refresh.
  const pingLocation = async (lat: number, lng: number) => {
    if (dealId == null) return;
    try {
      const r = await api.sendLocation(bearer(), dealId, lat, lng);
      setGeo({ distanceM: r.distanceM, coLocated: r.coLocated });
      if (r.state !== deal?.state) await pullDeal(bearer(), dealId);
    } catch { /* transient — the next ping retries */ }
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
      void primeLocation(); // ask once, up front — meetup times are ready before they're needed
    });

  const startDemo = () =>
    run(async () => {
      const b = await api.signup(`+1555${Date.now()}1`, 'Maya Chen');
      const s = await api.signup(`+1555${Date.now()}2`, 'Sam Rivera');
      setDemo({ buyer: { id: b.userId, name: b.name }, seller: { id: s.userId, name: s.name } });
      setSession(null);
      setViewAs('buyer');
      void primeLocation();
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

  // Tapping a push jumps straight to the relevant deal (or the invite list). Covers both a
  // tap while running and one that cold-started the app. Only when signed in.
  useEffect(() => {
    if (!session) return;
    const handle = (data: NotificationData) => {
      const id = typeof data?.dealId === 'string' ? data.dealId : null;
      if (id) openDeal(id);
      else if (data?.inviteToken) { goHome(); void loadHome(); }
    };
    void consumeInitialNotificationTap(handle);
    return onNotificationTap(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);
  // Signed image URLs are minted by the API's Supabase host (often localhost, which a
  // phone can't reach) — rewrite the origin to the host the app actually talks to.
  const reachableImage = (url: string | null): string | null =>
    url ? url.replace(/^https?:\/\/[^/]+/, SUPABASE_URL.replace(/\/$/, '')) : url;
  const loadMessages = async (auth: string, id: string) => {
    try {
      const { messages } = await api.listMessages(auth, id);
      setMessages(messages.map((m) => ({ ...m, imageUrl: reachableImage(m.imageUrl) })));
    } catch { /* transient */ }
  };
  const sendMessage = () =>
    run(async () => {
      if (!msgInput.trim()) return;
      await api.sendMessage(bearer(), dealId!, msgInput.trim());
      setMsgInput('');
      await loadMessages(bearer(), dealId!);
    });
  // Attach a photo to the chat (compressed). The current text field rides along as a caption.
  const attachImage = () =>
    run(async () => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setErr('Photo access is needed to share an image.'); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5, base64: true });
      const asset = res.canceled ? null : res.assets?.[0];
      if (!asset?.base64) return;
      setPendingImageUri(asset.uri); // show it immediately while the upload runs
      try {
        await api.sendMessage(bearer(), dealId!, msgInput.trim(), { base64: asset.base64, contentType: asset.mimeType ?? 'image/jpeg' });
        setMsgInput('');
        await loadMessages(bearer(), dealId!);
      } finally {
        setPendingImageUri(null);
      }
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
        if (e?.code === 'card_required') { promptAddCard(sendInvite); return; } // selling → card needed up front
        throw e;
      }
    });

  const acceptInvite = (token: string) =>
    run(async () => {
      const doAccept = async () => {
        const { dealId } = await api.acceptInvite(session!.accessToken, token);
        await loadHome();
        openDeal(dealId);
      };
      try {
        await doAccept();
      } catch (e: any) {
        if (e?.code !== 'card_required') throw e;
        promptAddCard(doAccept); // accepting as the seller → card needed to seal terms
      }
    });
  const declineInvite = (token: string) => run(async () => { await api.declineInvite(session!.accessToken, token); await loadHome(); });

  const deleteDraft = (id: string) => run(async () => { await api.deleteDeal(bearer(), id); await loadHome(); });

  // back out of a deal — free unless the OTHER side already committed to travel (headed out),
  // in which case backing out forfeits your deposit to them. Matches the machine's CANCEL rule.
  const cancelDeal = () => {
    const otherHeadedOut = myRole(deal!) === 'buyer' ? deal!.sellerHeadedOut : deal!.buyerHeadedOut;
    const forfeit = deal!.state === 'EN_ROUTE' && otherHeadedOut;
    Alert.alert(
      forfeit ? 'Back out?' : 'Cancel deal?',
      forfeit
        ? `The other person already headed out — backing out now forfeits your ${formatMoney(deal!.commitmentCents)} deposit to them.`
        : 'You can back out for a full refund — nothing is forfeited.',
      [
        { text: 'Keep deal', style: 'cancel' },
        { text: forfeit ? 'Back out' : 'Cancel deal', style: 'destructive', onPress: () => act({ type: 'CANCEL', actor: myRole(deal!) }) },
      ]
    );
  };
  const propose = (outcome: 'release' | 'refund' | 'split') => act({ type: 'PROPOSE_RESOLUTION', actor: myRole(deal!), outcome });

  // ---- meetup spot (fair-by-time safe spot) ----
  // Post my "coming from" (a fresh fix, or the coarse one primed at onboarding) so the
  // server can rank safe spots by BALANCED travel time. Returns false if we have no fix.
  const postMyLocation = async (): Promise<boolean> => {
    let lat = coarseLoc.current?.lat;
    let lng = coarseLoc.current?.lng;
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        lat = pos.coords.latitude; lng = pos.coords.longitude;
      }
    } catch { /* fall back to the primed coarse fix */ }
    if (lat == null || lng == null) return false;
    await api.sendLocation(bearer(), dealId!, lat, lng);
    return true;
  };
  const fetchSuggestions = async () => {
    const r = await api.meetupSuggestions(bearer(), dealId!);
    if (r.needLocation) { setSuggestions([]); setMeetupMsg("Finding a spot that's fair for you both — waiting on the other person's location."); return; }
    if (!r.suggestions.length) { setSuggestions([]); setMeetupMsg('No safe spots found near the midpoint — pick a custom spot.'); return; }
    setMeetupMsg(''); setSuggestions(r.suggestions);
  };
  // Auto: post my location + load ranked spots — no manual "share location" tap.
  // Demo drives one device, so we post BOTH parties from here (a couple km apart so the
  // midpoint is meaningful), falling back to a default origin when there's no GPS fix.
  const autoSuggest = () =>
    run(async () => {
      suggestedFor.current = dealId;
      if (demo) {
        const c = coarseLoc.current ?? { lat: 40.7128, lng: -74.006 }; // NYC fallback (simulator / denied)
        await api.sendLocation(`dev:${demo.buyer.id}`, dealId!, c.lat, c.lng);
        await api.sendLocation(`dev:${demo.seller.id}`, dealId!, c.lat + 0.02, c.lng + 0.015);
        await fetchSuggestions();
        return;
      }
      const posted = await postMyLocation();
      if (!posted) { setMeetupMsg('Turn on location to get fair meetup suggestions.'); return; }
      await fetchSuggestions();
    });
  const openMeetup = () => { setMeetupMsg(''); setComingFrom(''); setCustomSpot(''); setMeetupOpen(true); void autoSuggest(); };
  const shareFromAddress = () =>
    run(async () => {
      if (!comingFrom.trim()) { setMeetupMsg('Enter where you are coming from.'); return; }
      const g = await api.geocode(bearer(), comingFrom.trim());
      await api.sendLocation(bearer(), dealId!, g.lat, g.lng);
      await fetchSuggestions();
    });
  // Propose a meetup (spot + the selected time; null = ASAP). The OTHER side confirms.
  const proposeMeetup = (spot: { name: string; lat: number; lng: number; custom: boolean }) =>
    run(async () => {
      // never propose a time already in the past (a stale selection) — it would trip the
      // no-show clock instantly. Fall back to ASAP.
      const time = proposeTime != null && proposeTime > Date.now() ? proposeTime : null;
      await api.act(bearer(), dealId!, { type: 'PROPOSE_MEETUP', actor: myRole(deal!), name: spot.name, lat: spot.lat, lng: spot.lng, custom: spot.custom, time });
      setMeetupOpen(false);
      await pullDeal(bearer(), dealId!);
    });
  const chooseMeetup = (s: MeetupSpot) => proposeMeetup({ name: s.name, lat: s.lat, lng: s.lng, custom: false });
  const useCustomSpot = () =>
    run(async () => {
      if (!customSpot.trim()) { setMeetupMsg('Enter a custom address.'); return; }
      const g = await api.geocode(bearer(), customSpot.trim());
      Alert.alert('Use a custom spot?', `"${g.name}" isn't a verified safe location. Public, camera-covered spots — police stations, transit hubs — are safest.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Use it anyway', style: 'destructive', onPress: () => proposeMeetup({ name: g.name, lat: g.lat, lng: g.lng, custom: true }) },
      ]);
    });
  // The other party accepts the proposed spot + time (locks it in).
  const confirmMeetup = () =>
    run(async () => {
      await api.act(bearer(), dealId!, { type: 'CONFIRM_MEETUP', actor: myRole(deal!) });
      await pullDeal(bearer(), dealId!);
    });
  // Reschedule / change the spot: re-open the arrange sheet to propose again.
  const reschedule = () => { setProposeTime(deal?.meetupTime ?? null); openMeetup(); };

  const refresh = () => run(() => pullDeal(bearer(), dealId!));

  // keep the home lists (deals + incoming invites) fresh without a manual reload
  const pollHome = async () => {
    try {
      setDeals((await api.listDeals(bearer())).deals);
      if (session) setInvites((await api.listInvites(session.accessToken)).invites);
    } catch { /* transient */ }
  };

  // fire-and-forget feedback after a successful action — never blocks the flow
  const actionHaptic = (type: Action['type']) => {
    switch (type) {
      case 'FUND': case 'HEAD_OUT': case 'ARRIVE':
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        break;
      case 'ENTER_CODE': case 'CONFIRM_RECEIVED':
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        break;
      case 'OPEN_DISPUTE':
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        break;
      case 'RATE':
        void Haptics.selectionAsync().catch(() => {});
        break;
    }
  };

  const runAct = (action: Action) =>
    run(async () => {
      const doAct = async () => {
        const res = await api.act(bearer(), dealId!, action);
        if (res.secret) setCode(res.secret.releaseCode); // minted at REVEAL_CODE, buyer-only
        actionHaptic(action.type);
        await pullDeal(bearer(), dealId!);
      };
      try {
        await doAct();
      } catch (e: any) {
        if (e?.code !== 'card_required') throw e;
        promptAddCard(doAct, deal?.commitmentCents ?? 500);
      }
    });

  // Heading out is the commitment point: gate on a spot + live location, then confirm —
  // and, like adding a card, spell out the deposit that's on the line if they don't show.
  const confirmHeadOut = (action: Action) =>
    run(async () => {
      if (!deal?.meetupConfirmed) { setErr('Agree on a meetup spot + time first — that both-confirmed plan is what the clock runs on.'); return; }
      if (session && !(await ensureLiveLocation())) { setErr('Turn on location to head out — MeetMe uses it to detect arrival.'); return; }
      const deposit = formatMoney(deal.commitmentCents);
      const msg = myRole(deal) === 'seller'
        ? `A ${deposit} hold on your card backs this meetup — you're only charged it if you don't show, and it's released the moment the deal completes.`
        : `Your ${deposit} deposit is in escrow. Once you head out, backing out counts as a no-show and forfeits it.`;
      Alert.alert('Head to the meetup?', msg, [
        { text: 'Not yet', style: 'cancel' },
        { text: "I'm heading out", onPress: () => runAct(action) },
      ]);
    });

  const act = (action: Action) => (action.type === 'HEAD_OUT' ? confirmHeadOut(action) : runAct(action));

  // Auto-suggest: once a deal can take a spot and none is set, quietly post my location
  // and load the ranked safe spots so the top pick is ready to one-tap confirm.
  useEffect(() => {
    if (!deal || dealId == null) return;
    const canSet = ['DRAFT', 'AGREED', 'FUNDED', 'ARMED'].includes(deal.state) && !deal.meetupConfirmed;
    if (canSet && suggestedFor.current !== dealId) void autoSuggest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal?.state, deal?.meetupConfirmed, dealId]);

  // Auto-track: once you've headed out, stream live location until you're at the spot.
  // Real mode streams GPS; demo (one device) teleports you to the agreed spot so the
  // geofence still fires. Arrival is never a manual tap.
  useEffect(() => {
    const stop = () => { watchRef.current?.remove(); watchRef.current = null; };
    if (!deal || dealId == null || deal.state !== 'EN_ROUTE') { stop(); return; }
    const iHeadedOut = myRole(deal) === 'buyer' ? deal.buyerHeadedOut : deal.sellerHeadedOut;
    if (!iHeadedOut) { stop(); return; }

    if (demo) {
      if (deal.meetupLat != null && deal.meetupLng != null) void pingLocation(deal.meetupLat, deal.meetupLng);
      return;
    }
    if (watchRef.current) return; // already streaming
    let cancelled = false;
    void (async () => {
      if (!(await ensureLiveLocation())) return;
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 20, timeInterval: 7000 },
        (pos) => { void pingLocation(pos.coords.latitude, pos.coords.longitude); }
      );
      if (cancelled) { sub.remove(); return; }
      watchRef.current = sub;
    })();
    return () => { cancelled = true; stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal?.state, deal?.buyerHeadedOut, deal?.sellerHeadedOut, deal?.meetupLat, deal?.meetupLng, dealId, viewAs, demo]);

  // Auto-reveal: the moment the buyer is AT_MEETUP, mint + show the code (QR + digits)
  // without a manual "reveal" tap. Re-mints if we don't have the plaintext locally
  // (e.g. the screen was reopened) — safe, since the seller hasn't entered one yet.
  const revealing = useRef(false);
  useEffect(() => {
    if (!deal || dealId == null || deal.state !== 'AT_MEETUP' || myRole(deal) !== 'buyer' || code || revealing.current) return;
    revealing.current = true;
    void (async () => {
      try {
        const res = await api.act(bearer(), dealId, { type: 'REVEAL_CODE' });
        if (res.secret) setCode(res.secret.releaseCode);
        await pullDeal(bearer(), dealId);
      } catch { /* the buyer can retry by reopening */ }
      finally { revealing.current = false; }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal?.state, dealId, viewAs, code]);

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
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
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
    geo, names, rep, mapUrl, messages, msgInput, setMsgInput, pendingImageUri,
    // modals + inputs
    showTrust, setShowTrust, profile, profileOpen, setProfileOpen, profileLoading,
    statement, setStatement, meetupOpen, setMeetupOpen, comingFrom, setComingFrom,
    customSpot, setCustomSpot, suggestions, meetupMsg, proposeTime, setProposeTime,
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
    loadHome, pollHome, openDeal, loadMessages, sendMessage, attachImage, newDeal, inviteSomeone,
    acceptInvite, declineInvite, deleteDraft, cancelDeal, propose,
    openMeetup, shareFromAddress, chooseMeetup, useCustomSpot, proposeMeetup, confirmMeetup, reschedule,
    refresh, pullDeal, act, rate,
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
