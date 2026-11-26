CREATE TABLE wallet_cards (
  id uuid PRIMARY KEY,
  wallet_id uuid NOT NULL UNIQUE REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
  number_ciphertext text NOT NULL,
  number_lookup text NOT NULL UNIQUE CHECK (number_lookup ~ '^[0-9a-f]{64}$'),
  number_suffix char(4) NOT NULL CHECK (number_suffix ~ '^[0-9]{4}$'),
  pin_hash text NOT NULL CHECK (pin_hash LIKE '$argon2id$%'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','holder_blocked','admin_blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wallet_card_challenges (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('activate','reveal','change_pin','reset_pin','reactivate','reissue')),
  id uuid NOT NULL UNIQUE,
  digest text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  PRIMARY KEY (user_id, action)
);
CREATE TABLE wallet_card_limits (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('send','pin')),
  count integer NOT NULL CHECK (count > 0),
  until_at timestamptz NOT NULL,
  PRIMARY KEY (user_id,scope)
);
CREATE TABLE wallet_card_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  card_id uuid NOT NULL REFERENCES wallet_cards(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION vn_card_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Card event history is immutable'; END $$;
CREATE TRIGGER wallet_card_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON wallet_card_events
  FOR EACH STATEMENT EXECUTE FUNCTION vn_card_audit_immutable();

-- All existing debit writers, including older deployments, traverse this guard.
CREATE FUNCTION vn_card_guard_legacy_vote() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.source_kind='vote' THEN
    PERFORM 1 FROM wallet_accounts WHERE id=NEW.wallet_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM wallet_cards WHERE wallet_id=NEW.wallet_id) THEN
      RAISE EXCEPTION 'Card authorization required' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wallet_card_guard_legacy_vote BEFORE INSERT ON wallet_entries
  FOR EACH ROW EXECUTE FUNCTION vn_card_guard_legacy_vote();
