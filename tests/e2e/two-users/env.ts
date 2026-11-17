/**
 * Where the Supabase local stack is. CI exports these from `npx supabase status -o env` (Supabase CLI 3.2.0
 * prints API_URL, PUBLISHABLE_KEY, SECRET_KEY, ANON_KEY, SERVICE_ROLE_KEY, DB_URL and MAILPIT_URL);
 * see docs/slices/S2-ci.md. Read lazily, so importing a helper never throws outside a run.
 */
function required(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  throw new Error(`The two-user suite needs ${names.join(' or ')} (from \`npx supabase status -o env\`).`);
}

export const env = {
  /** Kong gateway of the local stack, e.g. http://127.0.0.1:54321. */
  get apiUrl(): string {
    return required('SUPABASE_API_URL', 'API_URL').replace(/\/$/, '');
  },
  /** Service-side key: the new `sb_secret_…` key or the legacy service_role JWT. Never printed. */
  get secretKey(): string {
    return required('SUPABASE_SECRET_KEY', 'SECRET_KEY', 'SERVICE_ROLE_KEY');
  },
  /** The browser-safe key the app is built with. */
  get publishableKey(): string {
    return required('VITE_SUPABASE_PUBLISHABLE_KEY', 'PUBLISHABLE_KEY', 'ANON_KEY');
  },
  /** e.g. postgresql://postgres:postgres@127.0.0.1:54322/postgres */
  get dbUrl(): string {
    return required('SUPABASE_DB_URL', 'DB_URL');
  },
  /** Mailpit, the local stack's mail catcher (web UI and HTTP API), e.g. http://127.0.0.1:54324. */
  get mailpitUrl(): string {
    return required('MAILPIT_URL', 'INBUCKET_URL').replace(/\/$/, '');
  },
  /** The production build of the app, served by `vite preview` against the local stack. */
  get appUrl(): string {
    return (process.env.TWO_USERS_APP_URL ?? 'http://localhost:4174').replace(/\/$/, '');
  },
};
