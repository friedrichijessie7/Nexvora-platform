-- NEXVORA customer platform additions. Apply after reviewing with the existing schema.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'personal' CHECK (account_type IN ('personal','business'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name text;
CREATE INDEX IF NOT EXISTS shipments_tracking_code_idx ON shipments (tracking_code);
CREATE INDEX IF NOT EXISTS users_verification_token_hash_idx ON users (verification_token_hash);
CREATE INDEX IF NOT EXISTS users_reset_token_hash_idx ON users (reset_token_hash);
CREATE INDEX IF NOT EXISTS users_user_id_idx ON users (id);

CREATE TABLE IF NOT EXISTS wallets (user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, balance_cents bigint NOT NULL DEFAULT 0 CHECK (balance_cents >= 0), currency text NOT NULL DEFAULT 'USD');
CREATE TABLE IF NOT EXISTS wallet_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, type text NOT NULL CHECK (type IN ('topup','payment','refund')), amount_cents bigint NOT NULL CHECK (amount_cents > 0), reference text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS quotes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id) ON DELETE SET NULL, price_cents bigint NOT NULL, expires_at timestamptz NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS claims (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, shipment_id uuid NOT NULL, type text NOT NULL CHECK (type IN ('damage','loss','delay')), description text NOT NULL, photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb, reference text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS share_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shipment_id uuid NOT NULL, token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS contact_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, email text NOT NULL, subject text, message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallets_owner_read ON wallets FOR SELECT USING (user_id = auth.uid());
CREATE POLICY wallet_transactions_owner_read ON wallet_transactions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY quotes_owner_read ON quotes FOR SELECT USING (user_id = auth.uid());
CREATE POLICY claims_owner_read ON claims FOR SELECT USING (user_id = auth.uid());
