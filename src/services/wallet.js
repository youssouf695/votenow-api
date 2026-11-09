const crypto=require('node:crypto');
const db=require('../config/database');
const {WalletAccount,WalletEntry,WalletTopup,WalletPurchase}=require('../models/Wallet');
const {User,Payment,Event,Candidate,Vote,Commission,KpayOperation}=require('../models');
const {integer,normalizePhone,grossForNet,amounts}=require('./kpayAmounts');
const {failure,hash}=require('./kpayOperations');
const kpay=require('./kpayClient'),{getConfig}=require('../config/kpay');
function uuid(value){if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))throw failure('Référence invalide');return value}
async function account(user,transaction){const row=await WalletAccount.findOne({where:{user_id:user.id},transaction,...(transaction?{lock:transaction.LOCK.UPDATE}:{})});if(!row)throw failure('Activez votre VoteNow Card.',409);return row}
async function quote(amount,phone){
 amount=integer(amount);if(amount<100||amount>1000000)throw failure('Recharge de 100 à 1 000 000 FCFA requise');phone=normalizePhone(phone);
 if(process.env.KPAY_WALLET_PRICING_CONFIRMED!=='true')throw failure('Les frais de recharge doivent être configurés et confirmés avant tout encaissement.',503);
 const predicted=await kpay.predictProvider(phone);
 const operator={MTN_MOMO_CMR:'MTN',ORANGE_CMR:'ORANGE'}[predicted.provider];if(predicted.country!=='CMR'||!operator)throw failure('Opérateur camerounais non pris en charge',422);
 const raw=process.env[`KPAY_WALLET_${operator}_RATE`];if(!raw||!/^0(?:\.\d+)?$/.test(raw))throw failure('Tarif de recharge non configuré',503);
 const result=grossForNet(amount,Number(raw),process.env.KPAY_WALLET_ROUNDING||'exact');
 return {...result,phone,provider:predicted.provider,environment:getConfig().mode};
}
async function initiate(user,input){
 if(!user.is_verified)throw failure('Un compte vérifié est nécessaire.',403);
 const request_key=uuid(input.request_id),amount=integer(input.amount),phone=normalizePhone(input.phone),wallet=await account(user);
 let topup=await WalletTopup.findOne({where:{request_key}});
 if(topup){if(topup.wallet_id!==wallet.id||topup.amount_fcfa!==amount||topup.phone!==phone)throw failure('Cette référence correspond à une autre recharge.',409);return topup}
 const pricing=await quote(amount,phone);
 if(pricing.gross!==input.expected_gross||pricing.fee!==input.expected_fee)throw failure('Les frais ont changé. Vérifiez le nouveau récapitulatif.',409);
 return db.transaction(async transaction=>{
  await account(user,transaction);topup=await WalletTopup.findOne({where:{request_key},transaction});
  if(topup){if(topup.wallet_id!==wallet.id||topup.amount_fcfa!==amount||topup.phone!==phone)throw failure('Référence déjà utilisée.',409);return topup}
  const id=crypto.randomUUID(),externalId=`vn-w-${id}`;
  topup=await WalletTopup.create({id,wallet_id:wallet.id,request_key,amount_fcfa:amount,gross_fcfa:pricing.gross,phone,provider:pricing.provider,pricing_snapshot:pricing,status:'pending'},{transaction});
  await KpayOperation.create({kind:'WALLET_TOPUP',domain_id:id,request_key,external_id:externalId,fingerprint:hash([wallet.id,amount,phone]),environment:pricing.environment,expected_amount:pricing.gross,target_net:amount,status:'CREATED',request_payload:{amount:pricing.gross,currency:'XAF',provider:pricing.provider,phoneNumber:phone,externalId,description:'Recharge VoteNow Card',metadata:{walletTopupId:id}}},{transaction});
  return topup;
 });
}
async function spend(user,input,ip){
 if(!user.is_verified)throw failure('Un compte vérifié est nécessaire.',403);
 const request_key=uuid(input.request_id),event_id=uuid(input.event_id),candidate_id=uuid(input.candidate_id),count=integer(input.votes_count),expected=integer(input.expected_amount);
 const fingerprint=hash([user.id,event_id,candidate_id,count,expected]);
 return db.transaction(async transaction=>{
  const wallet=await account(user,transaction);
  const replay=await WalletPurchase.findOne({where:{request_key},transaction});
  if(replay){if(replay.user_id!==user.id||replay.fingerprint!==fingerprint)throw failure('Référence liée à un autre vote.',409);return Payment.findByPk(replay.payment_id,{transaction})}
  const event=await Event.findByPk(event_id,{transaction,lock:transaction.LOCK.UPDATE}),now=Date.now();
  if(!event||event.archived_at||event.status!=='active'||event.starts_at&&new Date(event.starts_at)>now||event.ends_at&&new Date(event.ends_at)<=now)throw failure('Campagne indisponible');
  const candidate=await Candidate.findOne({where:{id:candidate_id,event_id,is_active:true},transaction,lock:transaction.LOCK.UPDATE});if(!candidate)throw failure('Candidat indisponible');
  const price=amounts(event.vote_price_fcfa,count,event.commission_rate);if(price.gross!==expected)throw failure('Le prix a changé. Actualisez.',409);
  if(wallet.balance_fcfa<price.gross)throw failure('Solde VoteNow Card insuffisant. Rechargez votre portefeuille.',422);
  const payment=await Payment.create({event_id,candidate_id,wallet_user_id:user.id,voter_phone:user.phone||null,voter_name:user.full_name,amount_fcfa:price.gross,votes_count:price.count,commission_amount:price.commission,net_to_organizer:price.net,commission_rate_applied:price.rate,method:'votenow_card',status:'success',provider_ref:`wallet-${request_key}`,ip_address:ip},{transaction});
  await WalletEntry.create({wallet_id:wallet.id,amount_delta:-price.gross,balance_after:0,source_kind:'vote',source_id:payment.id},{transaction});
  await Vote.bulkCreate(Array.from({length:count},()=>({payment_id:payment.id,event_id,candidate_id,quantity:1,ip_address:ip})),{transaction});
  await Candidate.increment({vote_count:count},{where:{id:candidate_id},transaction});
  await Event.increment({total_votes:count,total_collected:price.gross},{where:{id:event_id},transaction});
  await User.increment({balance_fcfa:price.net},{where:{id:event.organizer_id},transaction});
  await Commission.create({payment_id:payment.id,event_id,organizer_id:event.organizer_id,amount_fcfa:price.commission,rate_applied:price.rate,base_amount:price.gross,status:'pending'},{transaction});
  await WalletPurchase.create({user_id:user.id,request_key,payment_id:payment.id,fingerprint},{transaction});
  return payment;
 });
}
module.exports={account,quote,initiate,spend,uuid};
