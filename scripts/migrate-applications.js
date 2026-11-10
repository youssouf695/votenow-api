require('dotenv').config();
const db=require('../src/config/database');
async function migrate(){
 if(!process.argv.includes('--apply')){console.log('Plan : inscriptions publiques, images de catégories, candidatures et journal WhatsApp. Relancer avec --apply. Aucun solde modifié.');return;}
 await db.transaction(async transaction=>{await db.query(`
 SET LOCAL lock_timeout='10s'; SELECT pg_advisory_xact_lock(82114727);
 ALTER TABLE events ADD COLUMN IF NOT EXISTS candidate_mode varchar(20) NOT NULL DEFAULT 'manual';
 ALTER TABLE events ADD COLUMN IF NOT EXISTS registration_config jsonb NOT NULL DEFAULT '{}';
 ALTER TABLE events ADD COLUMN IF NOT EXISTS registration_version integer NOT NULL DEFAULT 0;
 DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='vn_candidate_mode_check') THEN ALTER TABLE events ADD CONSTRAINT vn_candidate_mode_check CHECK(candidate_mode IN ('manual','registration')); END IF; END $$;
 ALTER TABLE campaign_categories ADD COLUMN IF NOT EXISTS cover_image_url text;
 ALTER TABLE campaign_categories ADD COLUMN IF NOT EXISTS avatar_url text;
 CREATE TABLE IF NOT EXISTS campaign_application_uploads(
 id uuid PRIMARY KEY,event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,token_hash varchar(64) NOT NULL,
 image_url text,expires_at timestamptz NOT NULL,used_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS vn_application_upload_expiry ON campaign_application_uploads(expires_at);
 CREATE TABLE IF NOT EXISTS campaign_applications(
 id uuid PRIMARY KEY,event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,request_key uuid NOT NULL,
 fingerprint varchar(64) NOT NULL,category_id uuid REFERENCES campaign_categories(id) ON DELETE RESTRICT,
 full_name varchar(150) NOT NULL,whatsapp varchar(20) NOT NULL,photo_url text NOT NULL,slogan varchar(200) NOT NULL DEFAULT '',bio text NOT NULL DEFAULT '',
 answers jsonb NOT NULL,form_snapshot jsonb NOT NULL,consented_at timestamptz NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','changes_requested')),
 reason text NOT NULL DEFAULT '',candidate_id uuid UNIQUE REFERENCES candidates(id) ON DELETE RESTRICT,
 revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,request_key));
 CREATE INDEX IF NOT EXISTS vn_applications_event_status ON campaign_applications(event_id,status,created_at DESC);
 CREATE TABLE IF NOT EXISTS campaign_application_decisions(
 id uuid PRIMARY KEY,application_id uuid NOT NULL REFERENCES campaign_applications(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,previous_status varchar(20) NOT NULL,status varchar(20) NOT NULL,
 reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE OR REPLACE FUNCTION vn_immutable_application_decision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Une décision de candidature ne peut pas être modifiée ou supprimée' USING ERRCODE='23514'; END $$;
 DROP TRIGGER IF EXISTS vn_application_decision_guard ON campaign_application_decisions;
 CREATE TRIGGER vn_application_decision_guard BEFORE UPDATE OR DELETE ON campaign_application_decisions FOR EACH ROW EXECUTE FUNCTION vn_immutable_application_decision();
 CREATE TABLE IF NOT EXISTS campaign_application_notifications(
 id uuid PRIMARY KEY,decision_id uuid NOT NULL UNIQUE REFERENCES campaign_application_decisions(id) ON DELETE RESTRICT,
 phone varchar(20) NOT NULL,parameters jsonb NOT NULL,state varchar(20) NOT NULL DEFAULT 'manual' CHECK(state IN ('manual','sending','accepted','failed','unknown')),
 provider_id text,http_status integer,updated_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now());
 `,{transaction})});console.log('Inscriptions et candidatures initialisées. Aucun paiement, vote ou solde modifié.');
}
module.exports=migrate;
if(require.main===module)migrate().catch(e=>{console.error('Migration inscriptions refusée :',e.original?.code||e.code||e.message);process.exitCode=1}).finally(()=>db.close());
