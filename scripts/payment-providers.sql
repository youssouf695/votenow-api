CREATE TABLE IF NOT EXISTS payment_providers (
  id uuid NOT NULL UNIQUE,
  code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{0,31}$'),
  enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS provider_accounts (
  id uuid PRIMARY KEY,
  provider_code text NOT NULL REFERENCES payment_providers(code),
  environment text NOT NULL CHECK (environment IN ('sandbox','production')),
  account_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  UNIQUE (provider_code, environment, account_key)
);
CREATE TABLE IF NOT EXISTS provider_capabilities (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES provider_accounts(id),
  direction text NOT NULL CHECK (direction IN ('deposit','payout')),
  rail text NOT NULL CHECK (rail IN ('mtn_momo','orange_money')),
  country text NOT NULL CHECK (country = 'CMR'),
  currency text NOT NULL CHECK (currency = 'XAF'),
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL CHECK (priority >= 0),
  min_amount integer NOT NULL CHECK (min_amount > 0),
  max_amount integer NOT NULL CHECK (max_amount >= min_amount),
  UNIQUE (account_id, direction, rail, country, currency)
);
CREATE TABLE IF NOT EXISTS provider_tariff_versions (
  id uuid PRIMARY KEY,
  capability_id uuid NOT NULL REFERENCES provider_capabilities(id),
  effective_at timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('adapter','configured')),
  rate_units integer NOT NULL CHECK (rate_units BETWEEN 0 AND 99999999),
  fixed_fee integer NOT NULL CHECK (fixed_fee >= 0),
  min_fee integer NOT NULL CHECK (min_fee >= 0),
  max_fee integer CHECK (max_fee >= min_fee),
  rounding text NOT NULL CHECK (rounding IN ('exact','ceil_fee','floor_fee','round_fee')),
  published_by uuid,
  UNIQUE (capability_id, effective_at)
);
CREATE OR REPLACE FUNCTION vn_provider_tariff_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tarif publié immuable' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS provider_tariff_immutable ON provider_tariff_versions;
CREATE TRIGGER provider_tariff_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON provider_tariff_versions
FOR EACH STATEMENT EXECUTE FUNCTION vn_provider_tariff_immutable();
