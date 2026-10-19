const { createClient } = require('@supabase/supabase-js');
const env = require('../config/env');

// The service key is server-only. Routes enforce JWT/RBAC before using this client.
const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function createScopedClient(accessToken) {
  if (!env.SUPABASE_ANON_KEY) throw new Error('SUPABASE_ANON_KEY is required for RLS-scoped reads.');
  if (!accessToken) throw new Error('An access token is required for RLS-scoped reads.');
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
module.exports = { supabaseAdmin, createScopedClient };
