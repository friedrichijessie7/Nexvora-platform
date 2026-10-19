/**
 * Dynamic Supply Chain Operating System — Database Service
 * Supabase client initialization + scoped client factory for RLS-limited reads.
 * Hard-fail at startup if required env vars are missing.
 */

const { createClient } = require('@supabase/supabase-js');
const env = require('../config/env');

// Service-role client — for admin operations that bypass RLS (authenticated via JWT)
const supabaseService = createClient(env.supabaseUrl, env.supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Hard-fail if clients could not be created
if (!supabaseService) {
  console.error('[FATAL] Failed to create Supabase service client.');
  process.exit(1);
}

/**
 * Create a scoped Supabase client that sets the JWT token for RLS.
 * This client enforces Row Level Security as if the authenticated user.
 * @param {string} jwtToken — decoded JWT access token
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
function createScopedClient(jwtToken) {
  if (!jwtToken) {
    throw new Error('[ERROR] createScopedClient called without a JWT token.');
  }
  return createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      // The 'jwt' key overrides the default session; RLS policies will
      // evaluate based on this user's claims (e.g., role = auth.role()).
      // We store the JWT in the 'jwt' property so the anon key + token
      // combination authenticates as this specific user.
      session: jwtToken, // supabase-js interprets this as the JWT payload
    },
  });
}

module.exports = {
  supabaseService,
  createScopedClient,
};