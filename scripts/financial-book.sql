CREATE FUNCTION vn_book_balanced(lines jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT count(*) >= 2 AND coalesce(sum(line.amount), 1) = 0
    AND bool_and(line.account ~ '^[a-z_]+(:[a-zA-Z0-9_-]+)?$'
      AND line.amount IS NOT NULL AND line.amount <> 0
      AND abs(line.amount) < 1000000000000000 AND round(line.amount, 4) = line.amount)
    AND count(DISTINCT line.account) = count(*)
  FROM jsonb_to_recordset(lines) AS line(account text, amount numeric)
$$;

-- Positive lines are debits. This book never writes operational balances.
CREATE TABLE financial_book (
  kind text NOT NULL,
  source_id uuid NOT NULL,
  provider_code text,
  provider_account_id uuid REFERENCES provider_accounts(id),
  operation_id uuid,
  nominal_fcfa bigint NOT NULL DEFAULT 0 CHECK (nominal_fcfa >= 0),
  lines jsonb NOT NULL CHECK (vn_book_balanced(lines) IS TRUE),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (kind, source_id)
);
CREATE INDEX financial_book_recorded ON financial_book(recorded_at DESC, kind, source_id);
CREATE INDEX financial_book_provider ON financial_book(provider_code, recorded_at DESC);
CREATE TRIGGER financial_book_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON financial_book
  FOR EACH STATEMENT EXECUTE FUNCTION vn_financial_immutable();

CREATE TABLE votenow_fee_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  flow text NOT NULL CHECK (flow IN ('mobile_vote','card_topup')),
  rate_bps integer NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  effective_at timestamptz NOT NULL CHECK (isfinite(effective_at)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (char_length(trim(reason)) BETWEEN 10 AND 500),
  UNIQUE (flow, effective_at),
  CHECK (actor_id IS NULL OR effective_at > created_at)
);
CREATE TRIGGER votenow_fee_versions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON votenow_fee_versions
  FOR EACH STATEMENT EXECUTE FUNCTION vn_financial_immutable();

CREATE FUNCTION vn_book_post(entry_kind text, source uuid, operation uuid, provider text,
  account_id uuid, nominal bigint, accounts jsonb) RETURNS void
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE payload jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object('account', key, 'amount', value::numeric) ORDER BY key)
  INTO payload FROM jsonb_each_text(accounts) WHERE value::numeric <> 0;
  IF payload IS NULL THEN
    IF EXISTS (SELECT 1 FROM financial_book WHERE kind=entry_kind AND source_id=source) THEN
      RAISE EXCEPTION 'Financial replay differs from original';
    END IF;
    RETURN;
  END IF;
  INSERT INTO financial_book(kind,source_id,operation_id,provider_code,provider_account_id,nominal_fcfa,lines)
    VALUES (entry_kind,source,operation,provider,account_id,nominal,payload) ON CONFLICT DO NOTHING;
  IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM financial_book b WHERE b.kind=entry_kind
    AND b.source_id=source AND b.operation_id IS NOT DISTINCT FROM operation
    AND b.provider_code IS NOT DISTINCT FROM provider AND b.provider_account_id IS NOT DISTINCT FROM account_id
    AND b.nominal_fcfa=nominal AND b.lines=payload) THEN
    RAISE EXCEPTION 'Financial replay differs from original';
  END IF;
END $$;

CREATE FUNCTION vn_book_vote() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE op kpay_operations%ROWTYPE; owner uuid; wallet uuid; fee bigint; debit text; legacy_fee bigint := 0;
BEGIN
  IF NEW.status::text <> 'success' THEN RETURN NULL; END IF;
  IF TG_OP='UPDATE' AND OLD.status::text='success' THEN RETURN NULL; END IF;
  SELECT organizer_id INTO STRICT owner FROM events WHERE id=NEW.event_id;
  IF NEW.method='votenow_card' THEN
    SELECT id INTO STRICT wallet FROM wallet_accounts WHERE user_id=NEW.wallet_user_id;
    debit := 'card:' || wallet; fee := 0;
  ELSE
    SELECT * INTO op FROM kpay_operations WHERE kind='DEPOSIT' AND domain_id=NEW.id;
    IF NOT FOUND OR op.environment <> 'production' THEN RETURN NULL; END IF;
    fee := (op.pricing_snapshot->>'votenow_payment_fee_fcfa')::bigint;
    IF fee IS NULL THEN
      legacy_fee := op.expected_amount-NEW.amount_fcfa;
      fee := 0;
    END IF;
    IF legacy_fee < 0 OR op.expected_amount <> NEW.amount_fcfa + fee + legacy_fee THEN
      RAISE EXCEPTION 'Confirmed collection differs from VoteNow snapshot';
    END IF;
    debit := 'collection_receivable';
  END IF;
  PERFORM vn_book_post(CASE WHEN wallet IS NULL THEN 'mobile_vote' ELSE 'card_vote' END,
    NEW.id,op.id,CASE WHEN op.id IS NOT NULL THEN coalesce(op.pricing_snapshot#>>'{provider_selection,provider_code}','kpay') END,
    (op.pricing_snapshot#>>'{provider_selection,account_id}')::uuid,NEW.amount_fcfa,jsonb_build_object(
    debit,NEW.amount_fcfa+fee+legacy_fee,'organizer_available:'||owner,-NEW.net_to_organizer,
    'commercial_commission',-NEW.commission_amount,'payment_fee',-fee,'reconciliation_difference',-legacy_fee));
  RETURN NULL;
END $$;
CREATE TRIGGER financial_book_vote AFTER INSERT OR UPDATE OF status ON payments
  FOR EACH ROW EXECUTE FUNCTION vn_book_vote();

CREATE FUNCTION vn_book_topup() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE op kpay_operations%ROWTYPE; topup wallet_topups%ROWTYPE; fee bigint; legacy_fee bigint := 0;
BEGIN
  IF NEW.source_kind <> 'topup' THEN RETURN NULL; END IF;
  SELECT * INTO STRICT topup FROM wallet_topups WHERE id=NEW.source_id AND wallet_id=NEW.wallet_id;
  SELECT * INTO op FROM kpay_operations WHERE kind='WALLET_TOPUP' AND domain_id=NEW.source_id;
  IF NOT FOUND OR op.environment <> 'production' THEN RETURN NULL; END IF;
  fee := coalesce((op.pricing_snapshot->>'votenow_payment_fee_fcfa')::bigint,0);
  IF topup.pricing_snapshot->>'fee_policy' IS DISTINCT FROM 'same_as_vote' AND fee=0
      AND topup.gross_fcfa=op.expected_amount THEN
    legacy_fee := topup.gross_fcfa-topup.amount_fcfa;
  END IF;
  IF NEW.amount_delta <> topup.amount_fcfa OR op.expected_amount <> topup.amount_fcfa + fee + legacy_fee THEN
    RAISE EXCEPTION 'Confirmed top-up differs from VoteNow snapshot';
  END IF;
  PERFORM vn_book_post('card_topup',topup.id,op.id,coalesce(op.pricing_snapshot#>>'{provider_selection,provider_code}','kpay'),
    (op.pricing_snapshot#>>'{provider_selection,account_id}')::uuid,0,jsonb_build_object(
    'collection_receivable',op.expected_amount,'card:'||NEW.wallet_id,-NEW.amount_delta,
    'legacy_topup_fee_pass_through',-legacy_fee,'payment_fee',-fee));
  RETURN NULL;
END $$;
CREATE TRIGGER financial_book_topup AFTER INSERT ON wallet_entries
  FOR EACH ROW EXECUTE FUNCTION vn_book_topup();

CREATE FUNCTION vn_book_withdrawal() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE item withdrawals%ROWTYPE; op kpay_operations%ROWTYPE; selection jsonb;
BEGIN
  SELECT * INTO STRICT item FROM withdrawals WHERE id=NEW.withdrawal_id;
  SELECT * INTO op FROM kpay_operations WHERE id=NEW.operation_id;
  selection := coalesce(op.pricing_snapshot->'provider_selection',item.pricing_snapshot->'provider_selection');
  PERFORM vn_book_post('withdrawal_'||NEW.kind,item.id,op.id,
    coalesce(selection->>'provider_code',CASE WHEN op.id IS NOT NULL THEN 'kpay' END),
    (selection->>'account_id')::uuid,0,
    CASE NEW.kind
      WHEN 'reserve' THEN jsonb_build_object('organizer_available:'||item.organizer_id,item.amount_fcfa,
                                           'organizer_reserved:'||item.id,-item.amount_fcfa)
      WHEN 'release' THEN jsonb_build_object('organizer_reserved:'||item.id,item.amount_fcfa,
                                           'organizer_available:'||item.organizer_id,-item.amount_fcfa)
      ELSE jsonb_build_object('organizer_reserved:'||item.id,item.amount_fcfa,'provider_outflow',-item.amount_fcfa)
    END);
  RETURN NULL;
END $$;
CREATE TRIGGER financial_book_withdrawal AFTER INSERT ON financial_journal_entries
  FOR EACH ROW EXECUTE FUNCTION vn_book_withdrawal();

CREATE FUNCTION vn_book_provider_result() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE fee numeric; net numeric; provider text; account_id uuid; reference_kind text; sponsored boolean; prior numeric;
BEGIN
  IF NEW.environment <> 'production' OR OLD.status='COMPLETED'
      OR NEW.status NOT IN ('COMPLETED','RECONCILIATION') THEN RETURN NULL; END IF;
  provider := coalesce(NEW.pricing_snapshot#>>'{provider_selection,provider_code}','kpay');
  account_id := (NEW.pricing_snapshot#>>'{provider_selection,account_id}')::uuid;
  -- Only values present in the verified final event are eligible.
  IF NEW.last_event->>'feeAmount' ~ '^[0-9]{1,12}(\.[0-9]{1,4})?$' THEN fee := (NEW.last_event->>'feeAmount')::numeric; END IF;
  IF NEW.last_event->>'netAmount' ~ '^[0-9]{1,12}(\.[0-9]{1,4})?$' THEN net := (NEW.last_event->>'netAmount')::numeric; END IF;
  IF NEW.kind='PAYOUT' THEN
    IF NEW.status='RECONCILIATION' THEN
      IF NEW.error_code='NET_AMOUNT_MISMATCH' AND NEW.last_event->>'status'='COMPLETED' AND net>0
          AND NOT EXISTS (SELECT 1 FROM financial_book WHERE kind='payout_suspense' AND source_id=NEW.id) THEN
        PERFORM vn_book_post('payout_suspense',NEW.id,NEW.id,provider,account_id,0,
          jsonb_build_object('reconciliation_difference',net,'provider_outflow',-net));
      END IF;
      RETURN NULL;
    END IF;
    SELECT (line->>'amount')::numeric INTO prior FROM financial_book b
      CROSS JOIN LATERAL jsonb_array_elements(b.lines) AS line
      WHERE b.kind='payout_suspense' AND b.source_id=NEW.id AND line->>'account'='reconciliation_difference';
    IF prior IS NOT NULL THEN
      PERFORM vn_book_post('payout_suspense_release',NEW.id,NEW.id,provider,account_id,0,
        jsonb_build_object('reconciliation_difference',-prior,'provider_outflow',prior));
    END IF;
    SELECT fee_policy='votenow_pays_v1' INTO sponsored FROM withdrawals WHERE id=NEW.domain_id;
    IF sponsored AND fee IS NULL AND net IS NOT NULL AND net=NEW.target_net THEN
      fee := NEW.expected_amount-net;
    END IF;
    IF fee > 0 THEN
      PERFORM vn_book_post('payout_cost',NEW.id,NEW.id,provider,account_id,0,
        jsonb_build_object('payout_cost',fee,
          CASE WHEN sponsored THEN 'provider_outflow' ELSE 'recipient_fee_recovery' END,-fee));
    END IF;
  ELSIF NEW.status='COMPLETED' AND NEW.kind IN ('DEPOSIT','WALLET_TOPUP') THEN
    reference_kind := CASE NEW.kind WHEN 'DEPOSIT' THEN 'mobile_vote' ELSE 'card_topup' END;
    IF NOT EXISTS (SELECT 1 FROM financial_book WHERE kind=reference_kind AND source_id=NEW.domain_id) THEN RETURN NULL; END IF;
    IF fee IS NOT NULL AND net IS NOT NULL THEN
      PERFORM vn_book_post('collection_settlement',NEW.id,NEW.id,provider,account_id,0,
        jsonb_build_object('provider_funds',net,'collection_cost',fee,
          'reconciliation_difference',NEW.expected_amount-net-fee,'collection_receivable',-NEW.expected_amount));
    ELSIF fee > 0 THEN
      PERFORM vn_book_post('collection_cost',NEW.id,NEW.id,provider,account_id,0,
        jsonb_build_object('collection_cost',fee,'collection_receivable',-fee));
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER financial_book_provider_result AFTER UPDATE OF status ON kpay_operations
  FOR EACH ROW EXECUTE FUNCTION vn_book_provider_result();

-- Audited, externally verified funding evidence. No administrative HTTP write.
CREATE TABLE financial_funding_evidence (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES provider_accounts(id),
  evidence_ref text NOT NULL UNIQUE CHECK (char_length(trim(evidence_ref)) BETWEEN 8 AND 200),
  amount_delta bigint NOT NULL CHECK (amount_delta <> 0),
  actor_id uuid NOT NULL REFERENCES users(id),
  verified_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (char_length(trim(reason)) BETWEEN 10 AND 500),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (actor_id <> verified_by)
);
CREATE TRIGGER financial_funding_evidence_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON financial_funding_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION vn_financial_immutable();

CREATE FUNCTION vn_book_funding() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE funding bigint; used bigint; provider text;
BEGIN
  IF (SELECT count(*) FROM users WHERE id IN (NEW.actor_id, NEW.verified_by) AND role='admin') <> 2 THEN
    RAISE EXCEPTION 'Two distinct administrators must verify funding evidence';
  END IF;
  SELECT provider_code INTO STRICT provider FROM provider_accounts WHERE id=NEW.account_id AND environment='production';
  INSERT INTO payout_fee_funding(account_id,funded_fcfa) VALUES(NEW.account_id,0) ON CONFLICT DO NOTHING;
  SELECT funded_fcfa INTO STRICT funding FROM payout_fee_funding WHERE account_id=NEW.account_id FOR UPDATE;
  SELECT coalesce(sum(fee_fcfa),0) INTO used FROM payout_fee_reservations
    WHERE account_id=NEW.account_id AND state IN ('reserved','settled');
  IF funding+NEW.amount_delta < used THEN RAISE EXCEPTION 'Funding below committed fees'; END IF;
  UPDATE payout_fee_funding SET funded_fcfa=funding+NEW.amount_delta WHERE account_id=NEW.account_id;
  PERFORM vn_book_post('payout_funding',NEW.id,NULL,provider,NEW.account_id,0,
    jsonb_build_object('payout_funds',NEW.amount_delta,'provider_funding_transfer',-NEW.amount_delta));
  RETURN NULL;
END $$;
CREATE TRIGGER financial_book_funding AFTER INSERT ON financial_funding_evidence
  FOR EACH ROW EXECUTE FUNCTION vn_book_funding();

-- The operational envelope is a projection of audited evidence, never a free-form balance.
CREATE FUNCTION vn_book_check_funding_projection() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.account_id <> NEW.account_id THEN
    RAISE EXCEPTION 'Funding account is immutable';
  END IF;
  IF NEW.funded_fcfa <> (SELECT coalesce(sum(e.amount_delta),0)
      FROM financial_funding_evidence e WHERE e.account_id=NEW.account_id)
      AND NOT (TG_OP='INSERT' AND NEW.funded_fcfa=0) THEN
    RAISE EXCEPTION 'Funding requires audited evidence';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER financial_funding_matches_evidence AFTER INSERT OR UPDATE ON payout_fee_funding
  FOR EACH ROW EXECUTE FUNCTION vn_book_check_funding_projection();
CREATE TRIGGER financial_funding_no_delete BEFORE DELETE OR TRUNCATE ON payout_fee_funding
  FOR EACH STATEMENT EXECUTE FUNCTION vn_financial_immutable();

CREATE FUNCTION vn_book_allocation() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE provider text; delta bigint;
BEGIN
  SELECT provider_code INTO STRICT provider FROM provider_accounts WHERE id=NEW.account_id;
  delta := CASE WHEN TG_OP='INSERT' THEN NEW.fee_fcfa ELSE -NEW.fee_fcfa END;
  PERFORM vn_book_post('allocation_'||NEW.state,NEW.withdrawal_id,NEW.operation_id,provider,NEW.account_id,0,
    jsonb_build_object('memo_payout_allocated',delta,'memo_payout_unallocated',-delta));
  RETURN NULL;
END $$;
CREATE TRIGGER financial_book_allocation AFTER INSERT OR UPDATE ON payout_fee_reservations
  FOR EACH ROW EXECUTE FUNCTION vn_book_allocation();

-- A reconciled statement fills missing verified completion details once.
CREATE TABLE financial_settlement_evidence (
  operation_id uuid PRIMARY KEY REFERENCES kpay_operations(id),
  evidence_ref text NOT NULL UNIQUE CHECK (char_length(trim(evidence_ref)) BETWEEN 8 AND 200),
  actual_fee numeric(18,4) NOT NULL CHECK (actual_fee >= 0),
  actual_net numeric(18,4) NOT NULL CHECK (actual_net >= 0),
  actor_id uuid NOT NULL REFERENCES users(id),
  verified_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (char_length(trim(reason)) BETWEEN 10 AND 500),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (actor_id <> verified_by)
);
CREATE TRIGGER financial_settlement_evidence_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON financial_settlement_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION vn_financial_immutable();

CREATE FUNCTION vn_book_statement() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE op kpay_operations%ROWTYPE; provider text; account_id uuid; booked_fee numeric;
BEGIN
  IF (SELECT count(*) FROM users WHERE id IN (NEW.actor_id, NEW.verified_by) AND role='admin') <> 2 THEN
    RAISE EXCEPTION 'Two distinct administrators must verify settlement evidence';
  END IF;
  SELECT * INTO STRICT op FROM kpay_operations WHERE id=NEW.operation_id FOR UPDATE;
  IF op.environment <> 'production' OR op.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'Statement fill-in requires a confirmed production operation';
  END IF;
  IF EXISTS (SELECT 1 FROM financial_book WHERE source_id=op.id AND kind IN ('collection_settlement','payout_cost')) THEN
    RAISE EXCEPTION 'Settlement already booked';
  END IF;
  provider := coalesce(op.pricing_snapshot#>>'{provider_selection,provider_code}','kpay');
  account_id := (op.pricing_snapshot#>>'{provider_selection,account_id}')::uuid;
  IF op.kind='PAYOUT' THEN
    IF NEW.actual_net IS DISTINCT FROM op.target_net OR NOT EXISTS (
      SELECT 1 FROM financial_book WHERE kind='withdrawal_settle' AND source_id=op.domain_id
    ) THEN RAISE EXCEPTION 'Payout statement differs from settled withdrawal'; END IF;
    PERFORM vn_book_post('payout_cost',op.id,op.id,provider,account_id,0,
      jsonb_build_object('payout_cost',NEW.actual_fee,
        CASE WHEN (SELECT fee_policy FROM withdrawals WHERE id=op.domain_id)='votenow_pays_v1'
          THEN 'provider_outflow' ELSE 'recipient_fee_recovery' END,-NEW.actual_fee));
  ELSE
    IF NOT EXISTS (SELECT 1 FROM financial_book WHERE source_id=op.domain_id
      AND kind=CASE op.kind WHEN 'DEPOSIT' THEN 'mobile_vote' WHEN 'WALLET_TOPUP' THEN 'card_topup' END
    ) THEN RAISE EXCEPTION 'Collection not covered by this book'; END IF;
    SELECT coalesce(sum(line.amount),0) INTO booked_fee FROM financial_book b
      CROSS JOIN LATERAL jsonb_to_recordset(b.lines) AS line(account text,amount numeric)
      WHERE b.kind='collection_cost' AND b.source_id=op.id AND line.account='collection_cost';
    PERFORM vn_book_post('collection_settlement',op.id,op.id,provider,account_id,0,
      jsonb_build_object('provider_funds',NEW.actual_net,'collection_cost',NEW.actual_fee-booked_fee,
      'reconciliation_difference',op.expected_amount-NEW.actual_net-NEW.actual_fee,
      'collection_receivable',-op.expected_amount+booked_fee));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER financial_book_statement AFTER INSERT ON financial_settlement_evidence
  FOR EACH ROW EXECUTE FUNCTION vn_book_statement();
