import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { build } from './build';

let client: SupabaseClient<Database> | null = null;

/** The one Supabase client. Null in demo mode or when the build has no project settings. */
export function supabase(): SupabaseClient<Database> | null {
  if (build.demo) return null;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  client ??= createClient<Database>(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}
