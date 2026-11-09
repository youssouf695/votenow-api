const crypto=require('node:crypto');
const {User,WithdrawalBeneficiary,Withdrawal}=require('../models');
const sequelize=require('../config/database');
const {Op}=require('sequelize');
const {normalizePhone}=require('../services/kpayAmounts');
const kpay=require('../services/kpayClient');
const codes=require('../services/beneficiaryCode');
const send=require('../services/beneficiaryEmail');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function view(row){return {id:row.id,full_name:row.full_name,phone:row.phone,method:row.method,verified_at:row.verified_at,expires_at:row.expires_at,last_sent_at:row.last_sent_at};}
function respond(res,error){if(error.code==='BENEFICIARY_OTP_NOT_CONFIGURED')console.error('[beneficiary.config]',{code:error.code});return res.status(error.status||503).json({error:error.status?error.message:'Bénéficiaires temporairement indisponibles'});}
async function lockUser(id,transaction){const user=await User.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE});if(!user?.is_verified||!user.email)throw fail('Un compte vérifié avec email est nécessaire',403);return user;}
async function lockRow(id,userId,transaction){if(!uuid(id))throw fail('Bénéficiaire invalide');const row=await WithdrawalBeneficiary.findOne({where:{id,user_id:userId,deleted_at:null},transaction,lock:transaction.LOCK.UPDATE});if(!row)throw fail('Bénéficiaire introuvable',404);return row;}
async function challenge(row,user,transaction){
 if(row.verified_at)throw fail('Ce bénéficiaire est déjà validé',409);
 if(row.last_sent_at&&Date.now()-new Date(row.last_sent_at).getTime()<30000)throw fail('Patientez 30 secondes entre deux envois',429);
 const code=codes.generate();const verification_id=crypto.randomUUID();
 const values={verification_id,verification_email:user.email.trim().toLowerCase(),expires_at:new Date(Date.now()+15*60000),attempts:0,last_sent_at:new Date()};
 values.verification_hash=codes.digest({...row.get({plain:true}),verification_id},code,values.verification_email);
 await row.update(values,{transaction});return code;
}
exports.list=async(req,res)=>{try{const rows=await WithdrawalBeneficiary.findAll({where:{user_id:req.user.id,deleted_at:null},order:[['created_at','ASC']]});res.json({beneficiaries:rows.map(view),limit:3});}catch(error){respond(res,error);}};
exports.create=async(req,res)=>{try{
 codes.checkConfiguration();
 if(typeof req.body.full_name!=='string'||req.body.full_name.trim().length<2||req.body.full_name.trim().length>150)throw fail('Nom du bénéficiaire : 2 à 150 caractères');
 const name=req.body.full_name.trim(),phone=normalizePhone(req.body.phone);
 const predicted=await kpay.predictProvider(phone);
 const method={MTN_MOMO_CMR:'mtn_momo',ORANGE_CMR:'orange_money'}[predicted.provider];
 if(predicted.country!=='CMR'||!method)throw fail('Numéro Mobile Money camerounais non pris en charge',422);
 const result=await sequelize.transaction(async transaction=>{
  const user=await lockUser(req.user.id,transaction);
  if(await WithdrawalBeneficiary.count({where:{user_id:user.id,deleted_at:null},transaction})>=3)throw fail('Vous pouvez enregistrer au maximum trois bénéficiaires, y compris ceux en attente de validation.',409);
  let row=await WithdrawalBeneficiary.findOne({where:{user_id:user.id,phone},transaction,lock:transaction.LOCK.UPDATE});
  if(row&&!row.deleted_at)throw fail('Ce numéro est déjà enregistré. Utilisez le renvoi de code si nécessaire.',409);
  if(row)await row.update({full_name:name,method,deleted_at:null,verified_at:null,last_sent_at:null},{transaction});
  else row=await WithdrawalBeneficiary.create({user_id:user.id,full_name:name,phone,method},{transaction});
  const code=await challenge(row,user,transaction);return {user,row,code};
 });
 await send(result.user,result.row,result.code);
 res.status(201).json({message:'Code envoyé à l’email de votre compte',beneficiary:view(result.row),resend_after:30});
}catch(error){respond(res,error);}};
exports.resend=async(req,res)=>{try{
 codes.checkConfiguration();
 const result=await sequelize.transaction(async transaction=>{const user=await lockUser(req.user.id,transaction);const row=await lockRow(req.params.id,user.id,transaction);const code=await challenge(row,user,transaction);return {user,row,code};});
 await send(result.user,result.row,result.code);res.json({message:'Nouveau code envoyé',beneficiary:view(result.row),resend_after:30});
}catch(error){respond(res,error);}};
exports.verify=async(req,res)=>{try{
 codes.checkConfiguration();
 if(typeof req.body.code!=='string'||!/^\d{6}$/.test(req.body.code))throw fail('Code à six chiffres requis');
 const result=await sequelize.transaction(async transaction=>{
  const user=await lockUser(req.user.id,transaction),row=await lockRow(req.params.id,user.id,transaction);
  if(row.verified_at)return {row};
  if(row.verification_email!==user.email.trim().toLowerCase())return {error:fail('Votre email a changé. Demandez un nouveau code.',409)};
  if(!row.verification_hash||!row.expires_at||new Date(row.expires_at).getTime()<=Date.now())return {error:fail('Code expiré. Demandez un nouveau code.')};
  if(row.attempts>=5)return {error:fail('Trop de codes incorrects. Demandez un nouveau code.',429)};
  if(!codes.matches(row,req.body.code,user.email)){
   await row.update({attempts:row.attempts+1},{transaction});
   return {error:fail(row.attempts>=5?'Trop de codes incorrects. Demandez un nouveau code.':'Code incorrect',row.attempts>=5?429:400)};
  }
  await row.update({verified_at:new Date(),verification_hash:null,verification_id:null,expires_at:null,attempts:0},{transaction});return {row};
 });
 if(result.error)throw result.error;
 res.json({message:'Bénéficiaire validé',beneficiary:view(result.row)});
}catch(error){respond(res,error);}};
exports.remove=async(req,res)=>{try{
 await sequelize.transaction(async transaction=>{
  const user=await lockUser(req.user.id,transaction),row=await lockRow(req.params.id,user.id,transaction);
  const pending=await Withdrawal.findAll({where:{organizer_id:user.id,status:{[Op.in]:['pending','processing']}},attributes:['destination_phone'],transaction});
  const used=pending.some(item=>{try{return normalizePhone(item.destination_phone)===row.phone}catch{return false}});
  if(used)throw fail('Ce numéro est utilisé par un retrait en cours.',409);
  await row.update({deleted_at:new Date(),verified_at:null,verification_hash:null,verification_id:null,expires_at:null},{transaction});
 });res.json({message:'Bénéficiaire retiré. Les opérations historiques sont conservées.'});
}catch(error){respond(res,error);}};
