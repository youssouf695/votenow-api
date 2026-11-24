const crypto=require('node:crypto');
const db=require('../config/database');
const {WalletAccount,WalletEntry,WalletTopup,WalletPurchase}=require('../models/Wallet');
const {User,Payment,Event,Candidate,Vote,Commission,KpayOperation}=require('../models');
const {integer,normalizePhone}=require('./kpayAmounts');
const {failure,hash}=require('./kpayOperations');
const kpay=require('./kpayClient'),{getConfig}=require('../config/kpay');
function uuid(value){if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))throw failure('Référence invalide');return value}
async function account(user,transaction){const row=await WalletAccount.findOne({where:{user_id:user.id},transaction,...(transaction?{lock:transaction.LOCK.UPDATE}:{})});if(!row)throw failure('Activez votre VoteNow Card.',409);return row}
async function quote(amount,phone){
 amount=integer(amount);if(amount<100||amount>1000000)throw failure('Recharge de 100 à 1 000 000 FCFA requise');phone=normalizePhone(phone);
 const config=getConfig();
 if(process.env.PAYMENT_PROVIDER_MANAGER_ENABLED==='true'){
  const pricing=await require('./paymentProviders/manager').select({environment:config.mode,direction:'deposit',amount,phone});
  return {...pricing,checkout_fee:pricing.fee,checkout_total:pricing.gross,gross:amount,net:amount,fee:0,phone,provider:pricing.network,fee_policy:'same_as_vote'};
 }
 const predicted=await kpay.predictProvider(phone);
 if(predicted.country!=='CMR'||!['MTN_MOMO_CMR','ORANGE_CMR'].includes(predicted.provider))throw failure('Opérateur camerounais non pris en charge',422);
 let availability;try{availability=await kpay.availability()}catch{throw failure('Disponibilité Mobile Money momentanément invérifiable. Réessayez plus tard.',503)}
 const provider=Array.isArray(availability)?availability.find(row=>row.country==='CMR')?.providers?.find(row=>row.provider===predicted.provider):null;
 if(provider?.operationTypes?.DEPOSIT!=='OPERATIONAL')throw failure('Cet opérateur Mobile Money est actuellement indisponible.',503);
 // Same amount contract as a vote: KPay handles customer fees at checkout.
 // No additional VoteNow top-up fee, commission or gross-for-net calculation.
 return {gross:amount,net:amount,fee:0,phone,provider:predicted.provider,environment:config.mode,fee_policy:'same_as_vote'};
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
  await KpayOperation.create({kind:'WALLET_TOPUP',domain_id:id,request_key,external_id:externalId,fingerprint:hash([wallet.id,amount,phone]),environment:pricing.environment,expected_amount:pricing.gross,target_net:amount,status:'CREATED',...(pricing.provider_selection?{pricing_snapshot:pricing}:{}),request_payload:{amount:pricing.gross,currency:'XAF',provider:pricing.provider,phoneNumber:phone,externalId,description:'Recharge VoteNow Card',metadata:{walletTopupId:id}}},{transaction});
  return topup;
 });
}
async function quoteVote(user,input) {
 if(!user.is_verified)throw failure('Vérifiez votre compte avant de voter.',403);
 const event_id=uuid(input.event_id),candidate_id=uuid(input.candidate_id);
 const {votePrice,quoteBreakdown}=require('./votePricing');
 await account(user);
 const {unitPrice,price}=await votePrice({event_id,candidate_id,votes_count:input.votes_count,nominal_budget_fcfa:input.nominal_budget_fcfa});
 return quoteBreakdown(unitPrice,price,'votenow_card');
}
async function spend(user,input,ip){
 if(!user.is_verified)throw failure('Un compte vérifié est nécessaire.',403);
 const {votePrice,voteInteger}=require('./votePricing');
 const request_key=uuid(input.request_id),event_id=uuid(input.event_id),candidate_id=uuid(input.candidate_id);
 const count=voteInteger(input.votes_count,'Nombre de votes'),expected=voteInteger(input.expected_amount,'Montant accepté');
 const fingerprint=hash([user.id,event_id,candidate_id,count,expected]);
 return db.transaction(async transaction=>{
  const wallet=await account(user,transaction);
  const replay=await WalletPurchase.findOne({where:{request_key},transaction});
  if(replay){if(replay.user_id!==user.id||replay.fingerprint!==fingerprint)throw failure('Référence liée à un autre vote.',409);return Payment.findByPk(replay.payment_id,{transaction})}
  const {event,price}=await votePrice({event_id,candidate_id,votes_count:count,nominal_budget_fcfa:input.nominal_budget_fcfa},transaction);
  if(price.gross!==expected||price.count!==count)throw Object.assign(failure('Le prix a changé. Actualisez le devis et confirmez le nouveau montant.',409),{code:'VOTE_QUOTE_CHANGED'});
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
module.exports={quoteVote,account,quote,initiate,spend,uuid};
