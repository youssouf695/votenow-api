const db = require('../config/database');
const {Event} = require('../models');

const failure = (message,status = 400) => Object.assign(new Error(message),{status});
const query = async (sql,replacements,transaction) => (await db.query(sql,{replacements,transaction}))[0];
const scope = {type:'campaign_commission',changed:'CAMPAIGN_COMMISSION_CHANGED',noop:'CAMPAIGN_COMMISSION_NOOP'};

function uuid(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw failure('Référence invalide');
  return value.toLowerCase();
}
function rate(value) {
  if (!['number','string'].includes(typeof value) || !/^\d{1,2}(\.\d{1,2})?$/.test(String(value)) || Number(value)>50) {
    throw failure('Taux de 0 à 50 % requis, avec deux décimales au maximum');
  }
  return Number(value);
}
function reason(value) {
  if (typeof value !== 'string' || value.trim().length<10 || value.length>1000) throw failure('Motif interne de 10 à 1 000 caractères requis');
  return value.trim();
}

async function changeLocked(event, actor, input, transaction) {
  const next=rate(input.commission_rate);
  const previous=Number(event.commission_rate);
  const requestId=input.request_id == null ? null : uuid(input.request_id);
  if (!requestId && next===previous) return {replayed:false};
  const why=reason(input.reason);
  if (requestId) {
    const [prior]=await query(`
      SELECT actor_id,reason,details FROM transaction_admin_actions
      WHERE entity_type=:type AND entity_id=:id AND action IN (:changed,:noop) AND details->>'request_id'=:requestId
      ORDER BY id DESC LIMIT 1
    `,{...scope,id:event.id,requestId},transaction);
    if (prior) {
      if (prior.actor_id!==actor.id || prior.details.new_rate!==next || prior.reason!==why) {
        throw failure('Cette référence correspond à une autre modification',409);
      }
      return {replayed:true};
    }
  }
  if (next!==previous) await event.update({commission_rate:next},{transaction});
  await query(`
    INSERT INTO transaction_admin_actions(actor_id,actor_name,action,entity_type,entity_id,reason,details)
    VALUES (:actor,:name,:action,:type,:id,:why,CAST(:details AS jsonb))
  `,{actor:actor.id,name:actor.full_name,action:next===previous?scope.noop:scope.changed,
    type:scope.type,id:event.id,why,details:JSON.stringify({old_rate:previous,new_rate:next,request_id:requestId})},transaction);
  return {replayed:false};
}
async function change(eventId,actor,input={}) {
  const id=uuid(eventId);
  uuid(input.request_id);
  return db.transaction(async transaction=>{
    const event=await Event.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE});
    if (!event) throw failure('Campagne introuvable',404);
    if (event.archived_at) throw failure('Campagne archivée : modification interdite',409);
    const result=await changeLocked(event,actor,input,transaction);
    return {event_id:id,commission_rate:Number(event.commission_rate),...result};
  });
}

async function read(eventId,owner=null,page=1) {
  const id=uuid(eventId);
  const number=Number(page);
  if (!Number.isInteger(number)||number<1||number>10000) throw failure('Page invalide');
  return db.transaction(async transaction=>{
    const event=await Event.findOne({attributes:['id','organizer_id','commission_rate'],
      where:owner?{id,organizer_id:owner}:{id},transaction,lock:transaction.LOCK.SHARE});
    if (!event) throw failure('Campagne introuvable',404);
    const fields=owner?'':'actor_id,actor_name,reason,';
    const rows=await query(`
      SELECT ${fields} created_at,details->'old_rate' AS old_rate,details->'new_rate' AS new_rate
      FROM transaction_admin_actions WHERE entity_type=:type AND entity_id=:id AND action=:changed
      ORDER BY id DESC LIMIT :limit OFFSET :offset
    `,{...scope,id,limit:owner?1:51,offset:owner?0:(number-1)*50},transaction);
    const base={event_id:id,commission_rate:Number(event.commission_rate)};
    return owner ? {...base,last_change:rows[0]||null} : {...base,organizer_id:event.organizer_id,
      history:rows.slice(0,50),page:number,has_more:rows.length>50};
  });
}
module.exports={change,changeLocked,read};
