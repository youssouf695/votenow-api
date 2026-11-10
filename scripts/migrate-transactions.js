require('dotenv').config();
const fs=require('node:fs'),path=require('node:path'),db=require('../src/config/database');
async function migrate(){
 if(!process.argv.includes('--apply')){console.log('Plan : journal des états, notifications signées, interventions admin, suspensions. Protection des votes existants. Aucun mouvement de fonds. Relancer avec --apply.');return}
 await db.transaction(async transaction=>{await db.query("SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s'",{transaction});await db.query('SELECT pg_advisory_xact_lock(82114725)',{transaction});await db.query(fs.readFileSync(path.join(__dirname,'transactions.sql'),'utf8'),{transaction})});
 console.log('Module Transactions initialisé. Aucun solde ni vote modifié.');
}
module.exports=migrate;
if(require.main===module)migrate().catch(e=>{console.error('Migration Transactions refusée :',e.original?.code||e.code||e.message);process.exitCode=1}).finally(()=>db.close());
