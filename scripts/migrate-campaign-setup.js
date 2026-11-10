require('dotenv').config();
const db=require('../src/config/database');
async function migrate(){
 if(!process.argv.includes('--apply')){console.log('Plan : créer campaign_setups pour les cinq étapes privées de création. Aucun changement des campagnes publiées ou des soldes. Relancer avec --apply.');return}
 await db.transaction(async transaction=>{await db.query(`SET LOCAL lock_timeout='10s'; SELECT pg_advisory_xact_lock(82114726);
 CREATE TABLE IF NOT EXISTS campaign_setups(
 event_id uuid PRIMARY KEY REFERENCES events(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL UNIQUE,
 step integer NOT NULL DEFAULT 1 CHECK(step BETWEEN 1 AND 5),
 completed integer NOT NULL DEFAULT 0 CHECK(completed BETWEEN 0 AND 5),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 data jsonb NOT NULL,source_hash varchar(64) NOT NULL,
 published_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
 );
 CREATE OR REPLACE FUNCTION vn_guard_campaign_setup_publish() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW.status='active' AND EXISTS(SELECT 1 FROM campaign_setups WHERE event_id=NEW.id AND published_at IS NULL) THEN RAISE EXCEPTION 'Terminez les cinq étapes avant publication' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
 DROP TRIGGER IF EXISTS campaign_setup_publish_guard ON events;
 CREATE TRIGGER campaign_setup_publish_guard BEFORE UPDATE OF status ON events FOR EACH ROW EXECUTE FUNCTION vn_guard_campaign_setup_publish();
 `,{transaction})});console.log('Parcours de création initialisé. Aucun paiement ni solde modifié.');
}
module.exports=migrate;
if(require.main===module)migrate().catch(e=>{console.error('Migration du parcours refusée :',e.original?.code||e.code||e.message);process.exitCode=1}).finally(()=>db.close());
