CREATE TABLE financial_accounts (
  id uuid PRIMARY KEY,
  organizer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('available','reserved','provider_clearing','pre_coverage')),
  currency char(3) NOT NULL CHECK (currency = 'XAF'),
  book text NOT NULL CHECK (book = 'organizer_current'),
  UNIQUE (organizer_id, kind, currency, book)
);

CREATE TABLE financial_journal_entries (
  id uuid PRIMARY KEY,
  withdrawal_id uuid NOT NULL REFERENCES withdrawals(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('reserve','release','settle')),
  source text NOT NULL,
  operation_id uuid REFERENCES kpay_operations(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (withdrawal_id, kind),
  CHECK (idempotency_key = withdrawal_id::text || ':' || kind),
  CHECK (
    (kind = 'reserve' AND source = 'request' AND operation_id IS NULL) OR
    (kind = 'release' AND source = 'organizer_cancel') OR
    (kind = 'release' AND source = 'admin_reject' AND operation_id IS NULL) OR
    (kind = 'release' AND source = 'provider_failure' AND operation_id IS NOT NULL) OR
    (kind = 'settle' AND source = 'provider_success' AND operation_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX financial_journal_one_withdrawal_closure
  ON financial_journal_entries(withdrawal_id) WHERE kind IN ('release','settle');

CREATE TABLE financial_journal_lines (
  entry_id uuid NOT NULL REFERENCES financial_journal_entries(id) ON DELETE RESTRICT,
  side text NOT NULL CHECK (side IN ('debit','credit')),
  account_id uuid NOT NULL REFERENCES financial_accounts(id) ON DELETE RESTRICT,
  amount_fcfa integer NOT NULL CHECK (amount_fcfa > 0),
  PRIMARY KEY (entry_id, side),
  UNIQUE (entry_id, account_id)
);
CREATE INDEX financial_journal_lines_account ON financial_journal_lines(account_id, entry_id);

CREATE FUNCTION vn_financial_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Écriture financière immuable' USING ERRCODE = '23514';
END $$;

CREATE TRIGGER financial_accounts_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON financial_accounts
  FOR EACH STATEMENT EXECUTE FUNCTION vn_financial_immutable();
CREATE TRIGGER financial_entries_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON financial_journal_entries
  FOR EACH STATEMENT EXECUTE FUNCTION vn_financial_immutable();
CREATE TRIGGER financial_lines_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON financial_journal_lines
  FOR EACH STATEMENT EXECUTE FUNCTION vn_financial_immutable();

CREATE FUNCTION vn_financial_check_withdrawal() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  item withdrawals%ROWTYPE;
  debit_kind text;
  credit_kind text;
  source_account text;
  matched integer;
BEGIN
  SELECT * INTO STRICT item FROM withdrawals WHERE id = NEW.withdrawal_id;
  IF NEW.operation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM kpay_operations
    WHERE id = NEW.operation_id AND kind = 'PAYOUT' AND domain_id = item.id
  ) THEN
    RAISE EXCEPTION 'Opération source incohérente' USING ERRCODE = '23514';
  END IF;

  IF NEW.kind = 'reserve' THEN
    IF item.status <> 'pending' THEN
      RAISE EXCEPTION 'Statut incompatible avec la réservation' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM financial_journal_entries
      WHERE withdrawal_id = item.id AND kind IN ('release','settle')
    ) THEN
      RAISE EXCEPTION 'Retrait déjà clôturé dans le journal' USING ERRCODE = '23514';
    END IF;
    debit_kind := 'available';
    credit_kind := 'reserved';
  ELSE
    IF item.status::text IS DISTINCT FROM (CASE NEW.source
      WHEN 'organizer_cancel' THEN 'cancelled' WHEN 'provider_success' THEN 'done' ELSE 'rejected'
    END)::text THEN
      RAISE EXCEPTION 'Statut incompatible avec la clôture' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM financial_journal_entries WHERE withdrawal_id = item.id AND kind = 'reserve') THEN
      source_account := 'reserved';
    ELSIF item.created_at < vn_financial_coverage_start() THEN
      source_account := 'pre_coverage';
    ELSE
      RAISE EXCEPTION 'Réservation comptable absente' USING ERRCODE = '23514';
    END IF;
    debit_kind := source_account;
    credit_kind := CASE WHEN NEW.kind = 'release' THEN 'available' ELSE 'provider_clearing' END;
  END IF;

  SELECT count(*) INTO matched
  FROM financial_journal_lines l JOIN financial_accounts a ON a.id = l.account_id
  WHERE l.entry_id = NEW.id AND l.amount_fcfa = item.amount_fcfa
    AND a.organizer_id = item.organizer_id AND a.currency = 'XAF' AND a.book = 'organizer_current'
    AND a.kind = CASE l.side WHEN 'debit' THEN debit_kind ELSE credit_kind END;
  IF matched <> 2 THEN
    RAISE EXCEPTION 'Écriture financière incomplète ou déséquilibrée' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER financial_withdrawal_balanced
  AFTER INSERT ON financial_journal_entries DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION vn_financial_check_withdrawal();
