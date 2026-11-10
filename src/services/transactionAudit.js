const crypto=require('node:crypto'),db=require('../config/database');
const {QueryTypes}=require('sequelize');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const select=(sql,replacements={},transaction)=>db.query(sql,{replacements,type:QueryTypes.SELECT,transaction});
const base=`WITH records AS (
 SELECT 'vote'::text AS type,p.id,p.status::text,p.amount_fcfa AS amount,NULL::integer AS fee,p.net_to_organizer AS net,p.commission_amount AS commission,p.votes_count AS expected_votes,p.event_id,p.candidate_id,p.wallet_user_id AS user_id,p.method::text,p.voter_phone AS phone,p.voter_name AS name,p.provider_ref AS local_reference,p.created_at,p.updated_at
 FROM payments p
 UNION ALL SELECT 'topup',t.id,t.status,t.gross_fcfa,NULL::integer,t.amount_fcfa,0,0,NULL::uuid,NULL::uuid,w.user_id,CASE t.provider WHEN 'ORANGE_CMR' THEN 'orange_money' WHEN 'MTN_MOMO_CMR' THEN 'mtn_momo' ELSE t.provider END,t.phone,NULL::text,NULL::text,t.created_at,t.updated_at FROM wallet_topups t JOIN wallet_accounts w ON w.id=t.wallet_id
 UNION ALL SELECT 'withdrawal',w.id,w.status::text,w.amount_fcfa,w.fee_fcfa,w.net_fcfa,0,0,w.event_id,NULL::uuid,w.organizer_id,w.method::text,w.destination_phone,w.destination_name,w.transaction_ref,w.created_at,w.updated_at FROM withdrawals w
), enriched AS (
 SELECT r.*,e.title AS campaign,e.organizer_id,c.name AS candidate,u.full_name AS account_name,
 o.id AS operation_id,o.status AS provider_status,o.environment,o.expected_amount AS provider_amount,o.provider_id,o.provider_reference,o.external_id,o.provider_fee,o.provider_net,o.error_code,o.last_event,
 COALESCE(v.quantity,0)::integer AS credited_votes,COALESCE(v.bad_votes,0)::integer AS inconsistent_votes,
 COALESCE(we.credited,0)::integer AS wallet_credit,COALESCE(we.entries,0)::integer AS wallet_entries,
 COALESCE(wd.debited,0)::integer AS wallet_debit,COALESCE(rc.deliveries,0)::integer AS notifications,COALESCE(rc.rejected,0)::integer AS rejected_notifications
 FROM records r LEFT JOIN events e ON e.id=r.event_id LEFT JOIN candidates c ON c.id=r.candidate_id LEFT JOIN users u ON u.id=r.user_id
 LEFT JOIN kpay_operations o ON o.domain_id=r.id AND o.kind=CASE r.type WHEN 'vote' THEN 'DEPOSIT' WHEN 'topup' THEN 'WALLET_TOPUP' ELSE 'PAYOUT' END
 LEFT JOIN LATERAL(SELECT sum(v.quantity) AS quantity,count(*) FILTER(WHERE v.candidate_id<>r.candidate_id OR v.event_id<>r.event_id) AS bad_votes FROM votes v WHERE r.type='vote' AND v.payment_id=r.id) v ON true
 LEFT JOIN LATERAL(SELECT sum(w.amount_delta) AS credited,count(*) AS entries FROM wallet_entries w WHERE r.type='topup' AND w.source_kind='topup' AND w.source_id=r.id) we ON true
 LEFT JOIN LATERAL(SELECT sum(amount_delta) AS debited FROM wallet_entries WHERE r.type='vote' AND source_kind='vote' AND source_id=r.id) wd ON true
 LEFT JOIN LATERAL(SELECT sum(deliveries) AS deliveries,sum(CASE WHEN outcome='rejected' THEN deliveries ELSE 0 END) AS rejected FROM transaction_receipts WHERE external_id=o.external_id) rc ON true
), checked AS (
 SELECT *,array_remove(ARRAY[
 CASE WHEN provider_status='COMPLETED' AND status NOT IN ('success','done','refunded') THEN 'PROVIDER_COMPLETED_LOCAL_PENDING' END,
 CASE WHEN type='vote' AND status='success' AND credited_votes<>expected_votes THEN 'VOTE_QUANTITY_MISMATCH' END,
 CASE WHEN type='vote' AND credited_votes>0 AND status NOT IN ('success','refunded') THEN 'VOTES_WITHOUT_CONFIRMED_PAYMENT' END,
 CASE WHEN type='vote' AND status='success' AND method='votenow_card' AND wallet_debit<>-amount THEN 'VN_CARD_DEBIT_MISMATCH' END,
 CASE WHEN type='vote' AND status='success' AND commission+net<>amount THEN 'COMMISSION_SPLIT_MISMATCH' END,
 CASE WHEN provider_status IN ('FAILED','CANCELLED') AND status IN ('success','done') THEN 'CONFLICTING_FINAL_STATES' END,
 CASE WHEN inconsistent_votes>0 THEN 'VOTE_CAMPAIGN_MISMATCH' END,
 CASE WHEN type='topup' AND (status='success' OR provider_status='COMPLETED') AND (wallet_entries<>1 OR wallet_credit<>net) THEN 'WALLET_CREDIT_MISMATCH' END,
 CASE WHEN provider_status IN ('RECONCILIATION','AWAITING_DETAILS','UNKNOWN') THEN 'PROVIDER_REVIEW_REQUIRED' END,
 CASE WHEN rejected_notifications>0 THEN 'REJECTED_SIGNED_NOTIFICATION' END,
 CASE WHEN operation_id IS NOT NULL AND ((last_event->>'externalId' IS NOT NULL AND last_event->>'externalId'<>external_id) OR (last_event->>'paymentId' IS NOT NULL AND provider_id IS NOT NULL AND last_event->>'paymentId'<>provider_id)) THEN 'REFERENCE_MISMATCH' END,
 CASE WHEN status IN ('pending','processing') AND created_at<now()-INTERVAL '30 minutes' THEN 'LONG_PENDING' END
 ],NULL)::text[] AS anomalies FROM enriched
)`;
function filters(q){
 const values={},clauses=['true'];
 for(const key of ['event_id','candidate_id','user_id'])if(q[key]){if(!uuid(q[key]))throw fail('Identifiant de filtre invalide');values[key]=q[key];clauses.push(`${key}=:${key}`)}
 for(const [key,allowed] of [['type',['vote','topup','withdrawal']],['status',['pending','success','failed','refunded','processing','done','rejected','cancelled']],['method',['mtn_momo','orange_money','votenow_card','card','bank']],['environment',['sandbox','production']]])if(q[key]){if(!allowed.includes(q[key]))throw fail('Filtre invalide');values[key]=q[key];clauses.push(`${key}=:${key}`)}
 for(const key of ['from','to'])if(q[key]){if(typeof q[key]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(q[key])||!Number.isFinite(Date.parse(q[key]))||new Date(q[key]).toISOString().slice(0,10)!==q[key])throw fail('Date invalide');values[key]=q[key];clauses.push(key==='from'?`created_at>=CAST(:from AS date)`:`created_at<CAST(:to AS date)+INTERVAL '1 day'`)}
 if(values.from&&values.to&&values.from>values.to)throw fail('Période invalide');
 if(q.reference){if(typeof q.reference!=='string'||q.reference.length>150)throw fail('Référence invalide');values.reference='%'+q.reference.trim().replace(/[\\%_]/g,'\\$&')+'%';clauses.push(`(id::text ILIKE :reference OR provider_reference ILIKE :reference OR external_id ILIKE :reference OR provider_id ILIKE :reference OR local_reference ILIKE :reference)`)}
 if(q.anomaly==='true')clauses.push('cardinality(anomalies)>0');else if(q.anomaly&&q.anomaly!=='false')throw fail('Filtre anomalie invalide');
 const page=Number(q.page||1),limit=Number(q.limit||25);if(!Number.isInteger(page)||page<1||page>100000||!Number.isInteger(limit)||limit<1||limit>100)throw fail('Pagination invalide');
 return {values,where:clauses.join(' AND '),page,limit};
}
const columns=`type,id,status,amount,fee,net,commission,expected_votes,credited_votes,wallet_credit,wallet_entries,wallet_debit,event_id,candidate_id,user_id,account_name,campaign,candidate,method,created_at,updated_at,operation_id,provider_status,provider_amount,provider_id,provider_reference,external_id,local_reference,provider_fee,provider_net,environment,error_code,notifications,rejected_notifications,anomalies`;
async function list(q){
 const {values,where,page,limit}=filters(q);
 const [summary]=await select(`${base} SELECT count(*)::integer AS total,count(*) FILTER(WHERE cardinality(anomalies)>0)::integer AS flagged,count(*) FILTER(WHERE status IN ('pending','processing'))::integer AS pending,COALESCE(sum(amount) FILTER(WHERE type='vote' AND status='success'),0)::text AS paid_votes,COALESCE(sum(net) FILTER(WHERE type='topup' AND status='success'),0)::text AS credited_topups,COALESCE(sum(net) FILTER(WHERE type='withdrawal' AND status='done'),0)::text AS paid_withdrawals FROM checked WHERE ${where}`,values);
 const transactions=await select(`${base} SELECT ${columns},CASE WHEN phone IS NOT NULL THEN '••••'||right(phone,4) END AS phone_hint FROM checked WHERE ${where} ORDER BY created_at DESC,id DESC,type LIMIT :limit OFFSET :offset`,{...values,limit,offset:(page-1)*limit});
 return {transactions,summary,total:summary.total,page,limit,totalPages:Math.ceil(summary.total/limit)};
}
function validateIdentity(type,id){if(!['vote','topup','withdrawal'].includes(type)||!uuid(id))throw fail('Transaction invalide')}
async function detail(type,id){
 validateIdentity(type,id);
 const [transaction]=await select(`${base} SELECT ${columns},phone,name,organizer_id,CASE WHEN jsonb_typeof(last_event->'failureReason')='string' THEN left(last_event->>'failureReason',1000) END AS failure_reason FROM checked WHERE type=:type AND id=:id`,{type,id});
 if(!transaction)throw fail('Transaction introuvable',404);
 const [states,actions,notifications,votes,ledger]=await Promise.all([
 select(`SELECT id,entity_type,previous_state,state,snapshot,source,effective_at,recorded_at FROM transaction_states WHERE (entity_type=:type AND entity_id=:id) OR (entity_type='operation' AND entity_id=CAST(:operation AS uuid)) ORDER BY recorded_at DESC,id DESC LIMIT 200`,{type,id,operation:transaction.operation_id}),
 select(`SELECT id,actor_id,actor_name,action,reason,details,created_at FROM transaction_admin_actions WHERE entity_type=:type AND entity_id=:id ORDER BY id DESC LIMIT 100`,{type,id}),
 select(`SELECT digest,event_type,outcome,deliveries,first_seen_at,last_seen_at FROM transaction_receipts WHERE external_id=:external ORDER BY last_seen_at DESC LIMIT 100`,{external:transaction.external_id||''}),
 type==='vote'?select(`SELECT id,quantity,event_id,candidate_id,created_at FROM votes WHERE payment_id=:id ORDER BY created_at,id LIMIT 100`,{id}):Promise.resolve([]),
 select(`SELECT id,wallet_id,amount_delta,balance_after,source_kind,created_at FROM wallet_entries WHERE source_id=:id AND source_kind=:kind ORDER BY created_at LIMIT 100`,{id,kind:type==='topup'?'topup':type==='vote'?'vote':'none'})
 ]);
 return {transaction,states,actions,notifications,votes,ledger,history_note:'Les états antérieurs à l’installation ne sont pas reconstitués. Liste des votes limitée à 100 lignes ; total calculé sur toutes les lignes.'};
}
function reason(value){if(typeof value!=='string'||value.trim().length<10||value.length>500)throw fail('Motif requis (10 à 500 caractères)');return value.trim()}
async function audit(actor,action,type,id,motif,details={},transaction){return select(`INSERT INTO transaction_admin_actions(actor_id,actor_name,action,entity_type,entity_id,reason,details) VALUES(:actor,:name,:action,:type,:id,:reason,CAST(:details AS jsonb)) RETURNING id`,{actor:actor.id,name:actor.full_name,action,type,id,reason:motif,details:JSON.stringify(details)},transaction)}
async function account(id){if(!uuid(id))throw fail('Compte invalide');const [user]=await select(`SELECT u.id,u.full_name,u.email,u.role,COALESCE(r.suspended,false) AS suspended,r.reason,r.updated_at FROM users u LEFT JOIN user_restrictions r ON r.user_id=u.id WHERE u.id=:id`,{id});if(!user)throw fail('Compte introuvable',404);const actions=await select('SELECT actor_name,action,reason,created_at FROM transaction_admin_actions WHERE entity_type=\'account\' AND entity_id=:id ORDER BY id DESC LIMIT 50',{id});return {user,actions}}
async function restrict(actor,id,input){
 if(!uuid(id)||typeof input.suspended!=='boolean')throw fail('Suspension invalide');const motif=reason(input.reason);
 await db.transaction(async transaction=>{
  const [user]=await select('SELECT id,role FROM users WHERE id=:id FOR UPDATE',{id},transaction);
  if(!user)throw fail('Compte introuvable',404);if(user.role==='admin'||user.id===actor.id)throw fail('La suspension des comptes administrateurs est interdite.',403);
  await select(`INSERT INTO user_restrictions(user_id,suspended,reason,updated_by) VALUES(:id,:suspended,:reason,:actor) ON CONFLICT(user_id) DO UPDATE SET suspended=EXCLUDED.suspended,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING user_id`,{id,suspended:input.suspended,reason:motif,actor:actor.id},transaction);
  await db.query('UPDATE users SET auth_version=auth_version+1 WHERE id=:id',{replacements:{id},transaction});
  await audit(actor,input.suspended?'ACCOUNT_SUSPENDED':'ACCOUNT_RESTORED','account',id,motif,{},transaction);
 });return account(id);
}
async function recordReceipt(digest,event,outcome,count=true){
 const replacements={digest,external:String(event.externalId||'').slice(0,100),event:String(event.event).slice(0,40),outcome};
 if(count)await db.query(`INSERT INTO transaction_receipts(digest,external_id,event_type,outcome) VALUES(:digest,:external,:event,:outcome) ON CONFLICT(digest) DO UPDATE SET deliveries=transaction_receipts.deliveries+1,last_seen_at=now()`,{replacements});
 else await db.query('UPDATE transaction_receipts SET outcome=:outcome,last_seen_at=now() WHERE digest=:digest',{replacements});
}
async function verify(actor,type,id,input){
 const motif=reason(input.reason),{transaction:record}=await detail(type,id);
 if(!record.operation_id||!record.provider_id)throw fail('Aucune référence KPay consultable. Aucun nouvel encaissement ne sera lancé.',409);
 const {KpayOperation}=require('../models'),operation=await KpayOperation.findByPk(record.operation_id),{mode}=require('../config/kpay').getConfig();
 if(operation.environment!==mode)throw fail('Cette opération appartient à un autre environnement KPay.',409);
 const correlation=crypto.randomUUID();await audit(actor,'VERIFY_REQUEST',type,id,motif,{correlation});
 try{
  const response=await require('./kpayClient').getPayment(operation.provider_id),data=response?.data?.payment??response?.payment??response?.data??response;
  const {normalizePhone}=require('./kpayAmounts');
  if(!data||data.id!==operation.provider_id||data.externalId!==operation.external_id||Number(data.amount)!==operation.expected_amount||data.currency!=='XAF'||(typeof data.isTest==='boolean'&&data.isTest!==(mode==='sandbox'))||(data.provider&&data.provider!==operation.request_payload.provider)||(data.phoneNumber&&normalizePhone(data.phoneNumber)!==operation.request_payload.phoneNumber))throw fail('Réponse KPay incohérente. Aucun crédit manuel effectué.',409);
  const suffix={COMPLETED:'completed',FAILED:'failed',CANCELLED:'cancelled'}[data.status];
  if(suffix)await require('./kpayOperations').applyEvent({event:`${operation.kind==='PAYOUT'?'payout':'payment'}.${suffix}`,status:data.status,paymentId:data.id,externalId:data.externalId,amount:data.amount,currency:data.currency,reference:data.reference,isTest:data.isTest,provider:data.provider,phoneNumber:data.phoneNumber,feeAmount:data.feeAmount,netAmount:data.netAmount,failureReason:typeof data.failureReason==='string'?data.failureReason.slice(0,1000):null});
  await audit(actor,'VERIFY_RESULT',type,id,motif,{correlation,provider_status:typeof data.status==='string'?data.status.slice(0,32):'UNKNOWN'});
  return {...await detail(type,id),verification:{provider_status:data.status,applied:Boolean(suffix)}};
 }catch(error){await audit(actor,'VERIFY_FAILED',type,id,motif,{correlation,code:error.status===409?'RESPONSE_MISMATCH':'PROVIDER_OR_LOCAL_UNAVAILABLE'});throw error.status?error:fail('Vérification temporairement indisponible. Consultez le journal.',503)}
}
async function options(q){
 const term=v=>typeof v==='string'?v.trim().slice(0,100):'';if(q.event_id&&!uuid(q.event_id))throw fail('Campagne invalide');
 const campaigns=await select('SELECT id,title FROM events WHERE title ILIKE :search ORDER BY created_at DESC LIMIT 100',{search:'%'+term(q.search)+'%'});
 const candidates=q.event_id?await select('SELECT id,name FROM candidates WHERE event_id=:id AND name ILIKE :search ORDER BY name LIMIT 100',{id:q.event_id,search:'%'+term(q.candidate_search)+'%'}):[];
 return {campaigns,candidates};
}
async function journal(q){const page=Number(q.page||1);if(!Number.isInteger(page)||page<1||page>100000)throw fail('Page invalide');return {actions:await select('SELECT * FROM transaction_admin_actions ORDER BY id DESC LIMIT 50 OFFSET :offset',{offset:(page-1)*50}),page}}
module.exports={list,detail,account,restrict,verify,recordReceipt,options,journal,filters};
