CREATE TABLE IF NOT EXISTS transaction_states (
 id bigserial PRIMARY KEY, entity_type text NOT NULL, entity_id uuid NOT NULL,
 previous_state text, state text NOT NULL, snapshot jsonb NOT NULL DEFAULT '{}',
 source text NOT NULL, effective_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transaction_states_lookup ON transaction_states(entity_type,entity_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS transaction_states_baseline ON transaction_states(entity_type,entity_id) WHERE source='baseline';
CREATE TABLE IF NOT EXISTS transaction_admin_actions (
 id bigserial PRIMARY KEY, actor_id uuid NOT NULL, actor_name text NOT NULL,
 action text NOT NULL, entity_type text NOT NULL, entity_id uuid NOT NULL,
 reason text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transaction_admin_lookup ON transaction_admin_actions(entity_type,entity_id,id);
CREATE TABLE IF NOT EXISTS transaction_receipts (
 digest varchar(64) PRIMARY KEY, external_id varchar(100) NOT NULL,
 event_type varchar(40) NOT NULL, outcome varchar(20) NOT NULL,
 deliveries integer NOT NULL DEFAULT 1, first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transaction_receipt_lookup ON transaction_receipts(external_id);
CREATE TABLE IF NOT EXISTS user_restrictions (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
 suspended boolean NOT NULL, reason text NOT NULL, updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION vn_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Historique immuable' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS transaction_states_immutable ON transaction_states;
CREATE TRIGGER transaction_states_immutable BEFORE UPDATE OR DELETE ON transaction_states FOR EACH ROW EXECUTE FUNCTION vn_audit_immutable();
DROP TRIGGER IF EXISTS transaction_admin_immutable ON transaction_admin_actions;
CREATE TRIGGER transaction_admin_immutable BEFORE UPDATE OR DELETE ON transaction_admin_actions FOR EACH ROW EXECUTE FUNCTION vn_audit_immutable();
DROP TRIGGER IF EXISTS votes_immutable ON votes;
CREATE TRIGGER votes_immutable BEFORE UPDATE OR DELETE ON votes FOR EACH ROW EXECUTE FUNCTION vn_audit_immutable();
CREATE OR REPLACE FUNCTION vn_record_transaction_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n jsonb:=to_jsonb(NEW); o jsonb; snap jsonb;
BEGIN
 snap:=jsonb_strip_nulls(jsonb_build_object('error_code',n->'error_code','provider_id',n->'provider_id','provider_reference',n->'provider_reference','provider_fee',n->'provider_fee','provider_net',n->'provider_net'));
 IF TG_OP='UPDATE' THEN
  o:=to_jsonb(OLD);
  IF n->>'status' IS NOT DISTINCT FROM o->>'status' AND (n->>'error_code') IS NOT DISTINCT FROM (o->>'error_code') AND (n->>'provider_reference') IS NOT DISTINCT FROM (o->>'provider_reference') THEN RETURN NEW; END IF;
 END IF;
 INSERT INTO transaction_states(entity_type,entity_id,previous_state,state,snapshot,source,effective_at)
 VALUES(TG_ARGV[0],NEW.id,o->>'status',n->>'status',snap,lower(TG_OP),now());
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS payment_state_audit ON payments;
CREATE TRIGGER payment_state_audit AFTER INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION vn_record_transaction_state('vote');
DROP TRIGGER IF EXISTS topup_state_audit ON wallet_topups;
CREATE TRIGGER topup_state_audit AFTER INSERT OR UPDATE ON wallet_topups FOR EACH ROW EXECUTE FUNCTION vn_record_transaction_state('topup');
DROP TRIGGER IF EXISTS withdrawal_state_audit ON withdrawals;
CREATE TRIGGER withdrawal_state_audit AFTER INSERT OR UPDATE ON withdrawals FOR EACH ROW EXECUTE FUNCTION vn_record_transaction_state('withdrawal');
DROP TRIGGER IF EXISTS operation_state_audit ON kpay_operations;
CREATE TRIGGER operation_state_audit AFTER INSERT OR UPDATE ON kpay_operations FOR EACH ROW EXECUTE FUNCTION vn_record_transaction_state('operation');
INSERT INTO transaction_states(entity_type,entity_id,state,source,effective_at)
 SELECT b.entity_type,b.id,b.status,'baseline',b.updated_at FROM (
 SELECT 'vote' AS entity_type,id,status::text,updated_at FROM payments
 UNION ALL SELECT 'topup',id,status,updated_at FROM wallet_topups
 UNION ALL SELECT 'withdrawal',id,status::text,updated_at FROM withdrawals
 UNION ALL SELECT 'operation',id,status,updated_at FROM kpay_operations
 ) b WHERE NOT EXISTS(SELECT 1 FROM transaction_states s WHERE s.entity_type=b.entity_type AND s.entity_id=b.id)
 ON CONFLICT DO NOTHING;
