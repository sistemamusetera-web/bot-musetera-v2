import { createClient } from '@supabase/supabase-js';

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

export const supabaseAdmin = createClient(
  required('SUPABASE_URL'),
  required('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// The customer portal (portal.musetera.com.br) lives in a DIFFERENT
// Supabase project than the bot's own data. Portal accounts and their
// profiles (status / expires_at) must be managed through this client.
export const supabasePortal = createClient(
  required('PORTAL_SUPABASE_URL'),
  required('PORTAL_SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
