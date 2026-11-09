const crypto=require('node:crypto'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken');
const {Op,where,fn,col}=require('sequelize'),db=require('../config/database'),{User}=require('../models'),{PendingRegistration}=require('../models/Wallet'),env=require('../config/env');
const {sendVerificationEmail}=require('../services/email');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function digest(id,email,code){if(!env.jwt.secret||env.jwt.secret.length<32)throw fail('Configuration de vérification indisponible',503);return crypto.createHmac('sha256',env.jwt.secret).update(JSON.stringify(['registration',id,email,code])).digest('hex')}
function error(res,e){console.error('[registration.error]',{name:e.name,code:e.original?.code||e.code||null});res.status(e.status||e.name==='SequelizeUniqueConstraintError'&&409||503).json({error:e.status?e.message:e.name==='SequelizeUniqueConstraintError'?'Email ou téléphone déjà utilisé':'Inscription temporairement indisponible'})}
exports.send=async(req,res)=>{try{
 const {full_name,password}=req.body,email=typeof req.body.email==='string'?req.body.email.trim().toLowerCase():'',phone=typeof req.body.phone==='string'?req.body.phone.replace(/\D/g,'').replace(/^00/,''):'';
 const role=req.body.account_type||'organizer';
 if(!['voter','organizer'].includes(role))throw fail('Type de compte invalide');
 if(typeof full_name!=='string'||full_name.trim().length<2||full_name.trim().length>150||email.length>255||!/^\S+@\S+\.\S+$/.test(email)||!/^\d{8,15}$/.test(phone))throw fail('Nom, email ou téléphone invalide');
 if(typeof password!=='string'||password.length<8||Buffer.byteLength(password,'utf8')>72)throw fail('Mot de passe : 8 caractères minimum et 72 octets maximum');
 if(await User.findOne({where:{[Op.or]:[where(fn('lower',col('email')),email),where(fn('regexp_replace',col('phone'),'[^0-9]','','g'),phone)]}}))throw fail('Email ou téléphone déjà utilisé',409);
 await db.query(`DELETE FROM pending_registrations WHERE id IN (SELECT id FROM pending_registrations WHERE expires_at < now() ORDER BY expires_at LIMIT 1000)`);
 const code=crypto.randomInt(100000,1000000).toString(),id=crypto.randomUUID(),data={full_name:full_name.trim(),phone,role,password_hash:await bcrypt.hash(password,12)};
 await PendingRegistration.upsert({id,email,data,code_hash:digest(id,email,code),attempts:0,expires_at:new Date(Date.now()+15*60000)});
 try{await sendVerificationEmail(email,code,data.full_name)}catch{await PendingRegistration.destroy({where:{email,id}});throw fail('Le code n’a pas pu être envoyé. Réessayez plus tard.',503)}
 res.json({message:'Code envoyé par email',expires_in:15});
}catch(e){error(res,e)}};
exports.verify=async(req,res)=>{try{
 const email=typeof req.body.email==='string'?req.body.email.trim().toLowerCase():'',code=req.body.code;
 if(typeof code!=='string'||!/^\d{6}$/.test(code))throw fail('Code à six chiffres requis');
 const result=await db.transaction(async transaction=>{
  const row=await PendingRegistration.findOne({where:{email},transaction,lock:transaction.LOCK.UPDATE});
  if(!row||new Date(row.expires_at)<=Date.now())return {error:fail('Code invalide ou expiré')};
  if(row.attempts>=5)return {error:fail('Trop de tentatives. Demandez un nouveau code.',429)};
  const expected=digest(row.id,email,code);
  if(!crypto.timingSafeEqual(Buffer.from(row.code_hash,'hex'),Buffer.from(expected,'hex'))){await row.increment('attempts',{transaction});return {error:fail('Code incorrect')}}
  const user=await User.create({email,...row.data,is_verified:true},{transaction});await row.destroy({transaction});return {user};
 });
 if(result.error)throw result.error;
 const user=result.user;res.status(201).json({message:'Compte créé',token:jwt.sign({id:user.id,email:user.email,role:user.role},env.jwt.secret,{expiresIn:env.jwt.expire}),user:{id:user.id,email:user.email,phone:user.phone,full_name:user.full_name,role:user.role,is_verified:true,balance_fcfa:user.balance_fcfa}});
}catch(e){error(res,e)}};
