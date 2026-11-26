const crypto=require('node:crypto');
const db=require('../config/database');
const secrets=require('./cardSecrets');
const codes=require('./beneficiaryCode');
const send=require('./beneficiaryEmail');
const actions=new Set(['activate','reveal','change_pin','reset_pin','reactivate','reissue']);
const flag=()=>process.env.WALLET_CARD_IDENTITY_ENABLED==='true';
const fail=(code,status=400)=>Object.assign(new Error(code),{code,status});
const read=(sql,bind=[],transaction)=>db.query(sql,{bind,transaction,type:db.QueryTypes.SELECT,logging:false});
const one=async (...args)=>(await read(...args))[0];
const enabled=async transaction=>{
 if(!flag())return false;
 const state=await one(`SELECT to_regclass('wallet_cards') IS NOT NULL AND EXISTS (
   SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('wallet_entries')
   AND tgname='wallet_card_guard_legacy_vote' AND tgenabled IN ('O','A')
 ) AS ready`,[],transaction);
 return state.ready;
};
async function requireReady() {
 if(!await enabled())throw fail('CARD_UNAVAILABLE',503);
 secrets.checkConfiguration();
}
const view=card=>card?{status:card.status,last_four:card.number_suffix}:null;
async function state(userId) {
 if(!await enabled())return {enabled:false};
 const card=await one(`SELECT c.status,c.number_suffix FROM wallet_cards c
   JOIN wallet_accounts w ON w.id=c.wallet_id WHERE w.user_id=$1`,[userId]);
 return {enabled:true,card:view(card)};
}
async function forWallet(walletId,transaction) {
 const {installed}=await one("SELECT to_regclass('wallet_cards') IS NOT NULL AS installed",[],transaction);
 return installed?one('SELECT status FROM wallet_cards WHERE wallet_id=$1',[walletId],transaction):null;
}
async function lockOwner(userId,transaction) {
 const user=await one('SELECT id,email,full_name,is_verified,auth_version FROM users WHERE id=$1 FOR UPDATE',[userId],transaction);
 if(!user?.is_verified||!user.email)throw fail('VERIFIED_ACCOUNT_REQUIRED',403);
 return user;
}
async function lockWallet(userId,transaction) {
 const w=await one('SELECT id FROM wallet_accounts WHERE user_id=$1 FOR UPDATE',[userId],transaction);
 if(!w)throw fail('WALLET_REQUIRED',409);
 return w;
}
const lockedCard=(id,transaction)=>one('SELECT * FROM wallet_cards WHERE wallet_id=$1 FOR UPDATE',[id],transaction);
const now=()=>Date.now();
const challengeHash=(user,session,action,id,code)=>secrets.digest([
 'wallet-card',user.id,user.email.trim().toLowerCase(),user.auth_version,session,action,id,code
]);
async function count(userId,scope,seconds,transaction) {
 const row=await one(`
   INSERT INTO wallet_card_limits(user_id,scope,count,until_at)
   VALUES($1,$2,1,clock_timestamp()+make_interval(secs=>$3))
   ON CONFLICT(user_id,scope) DO UPDATE SET
     count=CASE WHEN wallet_card_limits.until_at<=clock_timestamp() THEN 1 ELSE LEAST(wallet_card_limits.count+1,100) END,
     until_at=CASE WHEN wallet_card_limits.until_at<=clock_timestamp() THEN excluded.until_at ELSE wallet_card_limits.until_at END
   RETURNING count
 `,[userId,scope,seconds],transaction);
 return row.count;
}
async function issue(userId,session,action,language) {
 await requireReady();
 if(!actions.has(action))throw fail('CARD_INVALID_ACTION');
 const result=await db.transaction(async transaction=>{
  const user=await lockOwner(userId,transaction);
  await lockWallet(userId,transaction);
  const previous=await one('SELECT sent_at FROM wallet_card_challenges WHERE user_id=$1 AND action=$2',[userId,action],transaction);
  if((previous&&now()-+new Date(previous.sent_at)<30000)||await count(userId,'send',3600,transaction)>5)return null;
  const code=codes.generate(),id=crypto.randomUUID();
  await read(`
    INSERT INTO wallet_card_challenges(user_id,action,id,digest,expires_at)
    VALUES($1,$2,$3,$4,clock_timestamp()+interval '15 minutes')
    ON CONFLICT(user_id,action) DO UPDATE SET id=excluded.id,digest=excluded.digest,
      sent_at=excluded.sent_at,expires_at=excluded.expires_at,attempts=0,consumed_at=NULL
  `,[userId,action,id,challengeHash(user,session,action,id,code)],transaction);
  return {user,code,id};
 });
 if(!result)throw fail('CARD_RATE_LIMIT',429);
 try {await send(result.user,null,result.code,{kind:'walletCard',language});}
 catch {throw fail('CARD_EMAIL_UNAVAILABLE',503);}
 return {challenge_id:result.id};
}
async function proof(user,session,action,input,transaction) {
 const row=await one(`SELECT id,digest,attempts FROM wallet_card_challenges
   WHERE user_id=$1 AND action=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`,[user.id,action],transaction);
 if(!row||row.id!==input.challenge_id)return 'CARD_CODE_INVALID';
 if(row.attempts>=5)return 'CARD_RATE_LIMIT';
 if(!secrets.equal(row.digest,challengeHash(user,session,action,row.id,input.code))){
  await read('UPDATE wallet_card_challenges SET attempts=attempts+1 WHERE id=$1',[row.id],transaction);
  return 'CARD_CODE_INVALID';
 }
 return null;
}
function freshNumber(id) {
 const value=secrets.number();
 return [secrets.seal(value,id),secrets.lookup(value),value.slice(-4)];
}
const collision=error=>(error.original?.code||error.code)==='23505'&&error.original?.constraint==='wallet_cards_number_lookup_key';
async function audit(card,actor,action,transaction,reason=null) {
 await read('INSERT INTO wallet_card_events(card_id,actor_id,action,reason) VALUES($1,$2,$3,$4)',[card.id,actor,action,reason],transaction);
}
async function invalidate(userId,transaction) {
 await read('UPDATE wallet_card_challenges SET consumed_at=clock_timestamp() WHERE user_id=$1 AND consumed_at IS NULL',[userId],transaction);
}
async function operate(userId,session,action,input) {
 await requireReady();
 if(!actions.has(action)&&action!=='block')throw fail('CARD_INVALID_ACTION');
 if(action!=='block'&&(typeof input.code!=='string'||!/^\d{6}$/.test(input.code)))throw fail('CARD_CODE_INVALID');
 if(['activate','change_pin','reset_pin'].includes(action)&&(!secrets.validPin(input.pin)||input.pin!==input.confirm_pin))throw fail('CARD_PIN_INVALID');
 for(let attempt=0;attempt<5;attempt++){
  try {
   const result=await db.transaction(async transaction=>{
    const user=await lockOwner(userId,transaction);
    const wallet=await lockWallet(userId,transaction);
    let card=await lockedCard(wallet.id,transaction);
    if(action==='activate'?card:!card)throw fail('CARD_STATE_CHANGED',409);
    if(action==='activate'&&!await enabled(transaction))throw fail('CARD_UNAVAILABLE',503);
    if((action==='block'&&card.status!=='active')||(action==='reactivate'&&card.status!=='holder_blocked'))throw fail('CARD_STATE_CHANGED',409);
    if(action!=='block'){
     const invalid=await proof(user,session,action,input,transaction);
     if(invalid)return {error:invalid};
    }
    if(['change_pin','reactivate','reissue'].includes(action)){
     if(await count(userId,'pin',900,transaction)>5)return {error:'CARD_RATE_LIMIT'};
     if(!await secrets.verifyPin(card.pin_hash,input.current_pin))return {error:'CARD_PIN_WRONG'};
    }
    if(action==='reveal'){
     await read('UPDATE wallet_card_challenges SET consumed_at=clock_timestamp() WHERE id=$1',[input.challenge_id],transaction);
     await audit(card,userId,action,transaction);
     return {number:secrets.unseal(card.number_ciphertext,card.id)};
    }
    if(action==='activate'){
     const id=crypto.randomUUID();
     card=await one(`INSERT INTO wallet_cards(id,wallet_id,number_ciphertext,number_lookup,number_suffix,pin_hash)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id,status,number_suffix`,
     [id,wallet.id,...freshNumber(id),await secrets.hashPin(input.pin)],transaction);
    }else{
     const common='UPDATE wallet_cards SET version=version+1,updated_at=clock_timestamp(),';
     const returning=' WHERE id=$1 RETURNING id,status,number_suffix';
     if(action==='reissue')card=await one(common+'number_ciphertext=$2,number_lookup=$3,number_suffix=$4'+returning,[card.id,...freshNumber(card.id)],transaction);
     else if(action==='change_pin'||action==='reset_pin'){
      card=await one(common+'pin_hash=$2'+returning,[card.id,await secrets.hashPin(input.pin)],transaction);
      if(action==='reset_pin')await read("DELETE FROM wallet_card_limits WHERE user_id=$1 AND scope='pin'",[userId],transaction);
     }else card=await one(common+'status=$2'+returning,[card.id,action==='block'?'holder_blocked':'active'],transaction);
    }
    await invalidate(userId,transaction);
    await audit(card,userId,action,transaction);
    return {card:view(card)};
   });
   if(result.error)throw fail(result.error,result.error==='CARD_RATE_LIMIT'?429:400);
   return result;
  }catch(error){if(!collision(error)||attempt===4)throw error;}
 }
}
async function admin(actorId,userId,action,reason) {
 await requireReady();
 if(!['block','release'].includes(action)||typeof reason!=='string'||reason.trim().length<10||reason.trim().length>500)throw fail('CARD_INVALID_ACTION');
 return db.transaction(async transaction=>{
  const wallet=await lockWallet(userId,transaction);
  const card=await lockedCard(wallet.id,transaction);
  if(!card||((card.status==='admin_blocked')!==(action==='release')))throw fail('CARD_STATE_CHANGED',409);
  const changed=await one(`UPDATE wallet_cards SET status=$2,version=version+1,updated_at=clock_timestamp()
    WHERE id=$1 RETURNING id,status,number_suffix`,[card.id,action==='block'?'admin_blocked':'holder_blocked'],transaction);
  await invalidate(userId,transaction);
  await audit(changed,actorId,'admin_'+action,transaction,reason.trim());
  return {card:view(changed)};
 });
}
module.exports={state,forWallet,issue,operate,admin};
