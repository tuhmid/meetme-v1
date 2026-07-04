import { createClient } from '@supabase/supabase-js';

/**
 * Verifies a real Supabase access token and resolves it to the user id
 * (`auth.uid()`), or null if invalid/expired. This is the production auth path;
 * the dev bearer token (`dev:<userId>`) stays available for local demos.
 */
export function makeSupabaseTokenVerifier(url: string, anonKey: string): (jwt: string) => Promise<string | null> {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return async (jwt: string): Promise<string | null> => {
    try {
      const { data, error } = await client.auth.getUser(jwt);
      if (error || !data.user) return null;
      return data.user.id;
    } catch {
      return null;
    }
  };
}
