CREATE TABLE payout_fee_funding (
  account_id uuid PRIMARY KEY REFERENCES provider_accounts(id) ON DELETE RESTRICT,
  funded_fcfa bigint NOT NULL CHECK (funded_fcfa >= 0)
);

-- Separate VoteNow fee entries. Only settled allocations represent actual cost.
CREATE TABLE payout_fee_reservations (
  withdrawal_id uuid PRIMARY KEY REFERENCES withdrawals(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES payout_fee_funding(account_id) ON DELETE RESTRICT,
  fee_fcfa integer NOT NULL CHECK (fee_fcfa >= 0),
  state text NOT NULL CHECK (state IN ('reserved','released','settled')),
  operation_id uuid UNIQUE REFERENCES kpay_operations(id) ON DELETE RESTRICT,
  closed_at timestamptz,
  CHECK ((state = 'reserved') = (closed_at IS NULL)),
  CHECK (state <> 'settled' OR operation_id IS NOT NULL)
);
CREATE INDEX payout_fee_reservations_account_state ON payout_fee_reservations(account_id,state);

CREATE FUNCTION vn_sponsored_payout_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.fee_policy IS NOT DISTINCT FROM 'votenow_pays_v1'
      OR NEW.fee_policy IS NOT DISTINCT FROM 'votenow_pays_v1')
     AND ROW(OLD.fee_policy,OLD.amount_fcfa,OLD.net_fcfa,OLD.fee_fcfa,OLD.pricing_snapshot)
       IS DISTINCT FROM ROW(NEW.fee_policy,NEW.amount_fcfa,NEW.net_fcfa,NEW.fee_fcfa,NEW.pricing_snapshot) THEN
    RAISE EXCEPTION 'Sponsored payout snapshot is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.fee_policy = 'votenow_pays_v1'
     AND (NEW.fee_fcfa IS DISTINCT FROM 0 OR NEW.net_fcfa IS DISTINCT FROM NEW.amount_fcfa
          OR NEW.pricing_snapshot->>'policy' IS DISTINCT FROM NEW.fee_policy) THEN
    RAISE EXCEPTION 'Invalid sponsored payout' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sponsored_payout_snapshot BEFORE INSERT OR UPDATE ON withdrawals
  FOR EACH ROW EXECUTE FUNCTION vn_sponsored_payout_snapshot();

CREATE FUNCTION vn_payout_fee_close_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Payout fee entries cannot be removed' USING ERRCODE='23514';
  END IF;
  IF OLD.state <> 'reserved' OR NEW.state NOT IN ('released','settled')
     OR ROW(OLD.withdrawal_id,OLD.account_id,OLD.fee_fcfa)
       IS DISTINCT FROM ROW(NEW.withdrawal_id,NEW.account_id,NEW.fee_fcfa) THEN
    RAISE EXCEPTION 'Invalid payout fee closure' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payout_fee_close_once BEFORE UPDATE OR DELETE ON payout_fee_reservations
  FOR EACH ROW EXECUTE FUNCTION vn_payout_fee_close_once();
CREATE TRIGGER payout_fee_no_truncate BEFORE TRUNCATE ON payout_fee_reservations
  FOR EACH STATEMENT EXECUTE FUNCTION vn_payout_fee_close_once();
