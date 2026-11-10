// Rebuild derived counters from recorded successful votes; never create votes,
// payments, commissions or balance entries. Preview is the default operation.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { QueryTypes, Transaction } = require('sequelize');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validId = id => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id || '');
const abort = message => { throw new Error(message); };
function createReconciler(db) {
  async function snapshot(eventId, transaction) {
    if (!validId(eventId)) abort('Identifiant campagne invalide');
    eventId = eventId.toLowerCase();
    const select = sql => db.query(sql,{transaction,replacements:{eventId},type:QueryTypes.SELECT});
    const [event] = await select('SELECT id,total_votes FROM events WHERE id=:eventId');
    if (!event) abort('Campagne introuvable');
    const candidates = await select('SELECT id,vote_count FROM candidates WHERE event_id=:eventId ORDER BY id');
    const votes = await select(`SELECT v.id,v.candidate_id,v.quantity,v.payment_id,p.status AS payment_status,
      p.event_id AS payment_event_id,p.candidate_id AS payment_candidate_id,p.votes_count AS payment_votes
      FROM votes v LEFT JOIN payments p ON p.id=v.payment_id WHERE v.event_id=:eventId ORDER BY v.id`);
    const totals = new Map(candidates.map(c=>[c.id,0])), byPayment = new Map();
    let total=0,excluded=0;
    for (const vote of votes) {
      if (!totals.has(vote.candidate_id) || vote.payment_event_id !== eventId || vote.payment_candidate_id !== vote.candidate_id) abort('Relation vote/paiement/candidat incohérente : rapprochement interrompu');
      const quantity=Number(vote.quantity), purchased=Number(vote.payment_votes);
      if (!Number.isSafeInteger(quantity) || quantity<1 || !Number.isSafeInteger(purchased) || purchased<1) abort('Quantité de votes invalide');
      byPayment.set(vote.payment_id,(byPayment.get(vote.payment_id)||0)+quantity);
      if (byPayment.get(vote.payment_id)>purchased) abort('Votes enregistrés supérieurs au paiement : examen nécessaire');
      if (vote.payment_status !== 'success') { excluded+=quantity;continue; }
      totals.set(vote.candidate_id,totals.get(vote.candidate_id)+quantity);total+=quantity;
    }
    if (total>2147483647) abort('Compteur hors limites');
    const changes=candidates.map(c=>({candidate_id:c.id,before:Number(c.vote_count),after:totals.get(c.id)}));
    return {event_id:eventId,event_total_before:Number(event.total_votes),event_total_after:total,
      candidates:changes,excluded_votes:excluded,
      source_hash:digest({event,candidates,votes})};
  }
  async function preview(eventId) {
    return db.transaction({isolationLevel:Transaction.ISOLATION_LEVELS.REPEATABLE_READ},async transaction=>{
      await db.query("SET TRANSACTION READ ONLY; SET LOCAL statement_timeout='15s'",{transaction});
      return {format:'votenow-vote-counter-plan-v1',generated_at:new Date().toISOString(),
        source:'Recorded Vote.quantity with Payment.status=success; no external KPay verification.',
        ...(await snapshot(eventId,transaction))};
    });
  }
  async function apply(plan) {
    if (plan?.format !== 'votenow-vote-counter-plan-v1' || !validId(plan.event_id) || !/^[a-f0-9]{64}$/.test(plan.source_hash||'')) abort('Rapport invalide');
    return db.transaction(async transaction=>{
      await db.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'",{transaction});
      // Short maintenance operation: concurrent writes wait or this transaction
      // rolls back on timeout. Recompute everything under lock, never trust plan values.
      await db.query('LOCK TABLE events,candidates,payments,votes IN SHARE ROW EXCLUSIVE MODE',{transaction});
      const state=await snapshot(plan.event_id,transaction);
      if (state.source_hash !== plan.source_hash) abort('Les données ont changé depuis le rapport. Générer un nouveau rapport avant correction.');
      for (const c of state.candidates) if (c.before !== c.after) {
        await db.query('UPDATE candidates SET vote_count=:count WHERE id=:id AND event_id=:eventId',{
          transaction,replacements:{count:c.after,id:c.candidate_id,eventId:state.event_id}
        });
      }
      if(state.event_total_before !== state.event_total_after) await db.query('UPDATE events SET total_votes=:total WHERE id=:id',{
        transaction,replacements:{total:state.event_total_after,id:state.event_id}
      });
      return {applied:true,event_id:state.event_id,total_votes:state.event_total_after,
        corrected_candidates:state.candidates.filter(c=>c.before!==c.after).length};
    });
  }
  return {preview,apply};
}
module.exports={createReconciler};
if(require.main===module){
  require('dotenv').config({quiet:true});
  const db=require('../src/config/database');
  (async()=>{
    const args=process.argv.slice(2),service=createReconciler(db);
    if(args.length===4&&args[0]==='--event'&&args[2]==='--output'){
      const report=await service.preview(args[1]);
      fs.writeFileSync(args[3],JSON.stringify(report,null,2)+'\n',{encoding:'utf8',flag:'wx'});
      console.log('Rapport créé sans modification : '+args[3]);
    }else if(args.length===2&&args[0]==='--apply'){
      console.log(JSON.stringify(await service.apply(JSON.parse(fs.readFileSync(args[1],'utf8'))),null,2));
    }else abort('Usage : --event UUID --output rapport.json OU --apply rapport.json');
  })().catch(e=>{console.error('Rapprochement interrompu :',e.original?.code||e.code||e.message);process.exitCode=1;}).finally(()=>db.close());
}
