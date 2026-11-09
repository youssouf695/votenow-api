require('dotenv').config();const db=require('../src/config/database');
async function migrate(){if(!process.argv.includes('--apply')){console.log('Plan : créer les événements de fréquentation et leurs index. Aucun historique fictif ajouté. Relancer avec --apply.');return}
await db.query(`CREATE TABLE IF NOT EXISTS analytics_events(id uuid PRIMARY KEY,visitor_key varchar(64) NOT NULL,session_key varchar(64) NOT NULL,user_id uuid,kind varchar(40) NOT NULL,path varchar(300) NOT NULL,referrer varchar(150),source varchar(100),device varchar(20),os varchar(30),browser varchar(30),country varchar(2),duration_ms integer NOT NULL DEFAULT 0,status integer,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS analytics_date ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS analytics_kind_date ON analytics_events(kind,created_at);
CREATE INDEX IF NOT EXISTS analytics_session_date ON analytics_events(session_key,created_at);
CREATE INDEX IF NOT EXISTS analytics_user_date ON analytics_events(user_id,created_at);`);console.log('Migration analytics terminée. La collecte commence après activation du code.');}
if(require.main===module)migrate().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.close());module.exports=migrate;
