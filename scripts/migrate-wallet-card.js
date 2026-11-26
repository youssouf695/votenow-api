const {readFileSync}=require('node:fs');
const path=require('node:path');

async function migrate(query) {
  await query('SELECT pg_advisory_xact_lock(82114731)');
  const [state]=await query(`SELECT to_regclass('wallet_cards') IS NOT NULL AS installed,
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('wallet_entries')
      AND tgname='wallet_card_guard_legacy_vote' AND tgenabled IN ('O','A')) AS guarded`);
  if(state.installed&&state.guarded)return;
  if(state.installed||state.guarded)throw new Error('Migration Card partielle');
  await query(readFileSync(path.join(__dirname,'wallet-card.sql'),'utf8'));
}
module.exports=migrate;
if(require.main===module){
  if(!process.argv.includes('--apply'))console.log('Plan : identité Card, défis, limites, audit et garde des dépenses historiques.');
  else {
    const db=require('../src/config/database');
    db.transaction(transaction=>migrate(async sql=>(await db.query(sql,{transaction}))[0]))
      .catch(error=>{console.error(error.original?.code||error.message);process.exitCode=1})
      .finally(()=>db.close());
  }
}
