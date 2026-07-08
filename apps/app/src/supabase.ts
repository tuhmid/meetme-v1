import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// The app uses Supabase for AUTH (phone OTP) and REALTIME only — all deal data
// flows through the API. On a physical phone, point these at your Mac's LAN IP,
// e.g. EXPO_PUBLIC_SUPABASE_URL=http://192.168.0.13:54321.
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321';
export const SUPABASE_URL = URL; // the host the APP can reach (LAN IP on a device)
// True when pointed at a local/LAN Supabase — used to surface dev-only test-login helpers.
export const IS_LOCAL_SUPABASE = /localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\./.test(URL);
// Well-known LOCAL-dev anon key (identical across every local Supabase; safe to
// embed for local dev). Override with EXPO_PUBLIC_SUPABASE_ANON_KEY for hosted.
const ANON =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export const supabase = createClient(URL, ANON, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
