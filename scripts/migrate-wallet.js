require('dotenv').config();
const db=require('../src/config/database');
async function migrate(){
 if(!process.argv.includes('--apply')){console.log('Plan : créer les comptes, écritures immuables, recharges et achats VoteNow Card ; stockage des pré-inscriptions. Aucun solde organisateur transféré. Relancer avec --apply.');return}
 await db.authenticate();
 await db.query(`ALTER TYPE enum_payments_method ADD VALUE IF NOT EXISTS 'votenow_card'`);
 await db.transaction(async transaction=>{
  const run=sql=>db.query(sql,{transaction});
  await run('SELECT pg_advisory_xact_lock(82114723)');
  await run(`CREATE TABLE IF NOT EXISTS wallet_accounts(id uuid PRIMARY KEY,user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,balance_fcfa integer NOT NULL DEFAULT 0 CHECK(balance_fcfa>=0),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS wallet_entries(id uuid PRIMARY KEY,wallet_id uuid NOT NULL REFERENCES wallet_accounts(id) ON DELETE RESTRICT,amount_delta integer NOT NULL CHECK(amount_delta<>0),balance_after integer NOT NULL CHECK(balance_after>=0),source_kind varchar(20) NOT NULL CHECK(source_kind IN ('topup','vote','refund')),source_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(wallet_id,source_kind,source_id));
  CREATE TABLE IF NOT EXISTS wallet_topups(id uuid PRIMARY KEY,wallet_id uuid NOT NULL REFERENCES wallet_accounts(id) ON DELETE RESTRICT,request_key uuid NOT NULL UNIQUE,amount_fcfa integer NOT NULL CHECK(amount_fcfa BETWEEN 100 AND 1000000),gross_fcfa integer NOT NULL CHECK(gross_fcfa>=amount_fcfa),phone varchar(20) NOT NULL,provider varchar(32) NOT NULL,status varchar(24) NOT NULL DEFAULT 'pending',pricing_snapshot jsonb NOT NULL,completed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS wallet_purchases(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,request_key uuid NOT NULL UNIQUE,payment_id uuid NOT NULL UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,fingerprint varchar(64) NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS pending_registrations(id uuid PRIMARY KEY,email varchar(255) NOT NULL UNIQUE,data jsonb NOT NULL,code_hash varchar(64) NOT NULL,attempts integer NOT NULL DEFAULT 0,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
  ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 0;
  ALTER TABLE payments ADD COLUMN IF NOT EXISTS wallet_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;
  ALTER TABLE payments ALTER COLUMN voter_phone DROP NOT NULL;
  CREATE INDEX IF NOT EXISTS pending_registrations_expiry ON pending_registrations(expires_at);
  CREATE INDEX IF NOT EXISTS wallet_entries_wallet_date ON wallet_entries(wallet_id,created_at DESC);
  CREATE INDEX IF NOT EXISTS wallet_topups_wallet_date ON wallet_topups(wallet_id,created_at DESC);`);
  await run(`CREATE OR REPLACE FUNCTION wallet_post_entry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   UPDATE wallet_accounts SET balance_fcfa=balance_fcfa+NEW.amount_delta,updated_at=now() WHERE id=NEW.wallet_id AND balance_fcfa+NEW.amount_delta>=0 RETURNING balance_fcfa INTO NEW.balance_after;
   IF NOT FOUND THEN RAISE EXCEPTION 'wallet balance unavailable' USING ERRCODE='23514'; END IF; RETURN NEW;
  END $$;
  CREATE OR REPLACE FUNCTION wallet_entry_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'wallet entries are immutable' USING ERRCODE='23514'; END $$;
  DROP TRIGGER IF EXISTS wallet_post_entry ON wallet_entries;
  CREATE TRIGGER wallet_post_entry BEFORE INSERT ON wallet_entries FOR EACH ROW EXECUTE FUNCTION wallet_post_entry();
  DROP TRIGGER IF EXISTS wallet_entry_immutable ON wallet_entries;
  CREATE TRIGGER wallet_entry_immutable BEFORE UPDATE OR DELETE ON wallet_entries FOR EACH ROW EXECUTE FUNCTION wallet_entry_immutable();`);
 });console.log('Migration VoteNow Card terminée.');
}
if(require.main===module)migrate().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.close());
module.exports=migrate;
