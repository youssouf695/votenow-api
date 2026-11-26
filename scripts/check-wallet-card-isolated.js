const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Client}=require('pg');
const migrate=require('./migrate-wallet-card');

async function check(client) {
 const sql=async (statement,bind)=>(await client.query(statement,bind)).rows;
 const schema='vn_card_test_'+crypto.randomBytes(12).toString('hex');
 await sql('BEGIN');
 try {
  await sql(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}; SET LOCAL statement_timeout='15s'`);
  await sql(`
    CREATE TABLE users(id uuid PRIMARY KEY,email text,full_name text,is_verified boolean,auth_version integer);
    CREATE TABLE wallet_accounts(id uuid PRIMARY KEY,user_id uuid UNIQUE REFERENCES users(id),balance_fcfa integer);
    CREATE TABLE wallet_entries(id uuid PRIMARY KEY,wallet_id uuid REFERENCES wallet_accounts(id),source_kind text);
  `);
  await migrate(sql);
  await migrate(sql);
  for(const name of ['CARD_NUMBER_KEY','CARD_LOOKUP_KEY','CARD_PIN_PEPPER','CARD_OTP_KEY'])process.env[name]=crypto.randomBytes(32).toString('hex');
  process.env.WALLET_CARD_IDENTITY_ENABLED='true';
  const mock=(name,exports)=>{const id=require.resolve(name);require.cache[id]={id,loaded:true,exports};};
  mock('../src/config/database',{
   QueryTypes:{SELECT:'SELECT'},query:(statement,options)=>sql(statement,options.bind),
   transaction:async operation=>{
    await sql('SAVEPOINT card_test');
    try{const result=await operation({});await sql('RELEASE SAVEPOINT card_test');return result;}
    catch(error){await sql('ROLLBACK TO SAVEPOINT card_test');await sql('RELEASE SAVEPOINT card_test');throw error;}
   },
  });
  let otp;
  mock('../src/services/beneficiaryEmail',async (user,context,code)=>{otp=code;});
  const service=require('../src/services/walletCard');
  const secrets=require('../src/services/cardSecrets');
  const [user,admin,wallet,history]=Array.from({length:4},crypto.randomUUID);
  await sql("INSERT INTO users VALUES($1,'wallet@example.invalid','Test Card',true,0),($2,'admin@example.invalid','Admin',true,0)",[user,admin]);
  await sql('INSERT INTO wallet_accounts VALUES($1,$2,1250)',[wallet,user]);
  await sql("INSERT INTO wallet_entries VALUES($1,$2,'vote')",[history,wallet]);
  const session='synthetic-session';
  const input={pin:'082745',confirm_pin:'082745'};
  const issue=async action=>{
   const result=await service.issue(user,session,action,'fr');
   return {...result,code:otp};
  };
  const enrollment=await issue('activate');
  await assert.rejects(service.operate(user,'another-session','activate',{...input,...enrollment}),/CARD_CODE_INVALID/);
  await assert.rejects(service.operate(user,session,'activate',{pin:'123456',confirm_pin:'123456',...enrollment}),/CARD_PIN_INVALID/);
  const {card}=await service.operate(user,session,'activate',{...input,...enrollment});
  assert.match(card.last_four,/^\d{4}$/);
  await assert.rejects(service.operate(user,session,'activate',{...input,...enrollment}),/CARD_STATE_CHANGED/);
  assert.equal((await sql('SELECT balance_fcfa FROM wallet_accounts WHERE id=$1',[wallet]))[0].balance_fcfa,1250);
  assert.equal((await sql('SELECT count(*)::int n FROM wallet_entries'))[0].n,1);
  await sql('SAVEPOINT active_guard');
  await assert.rejects(sql("INSERT INTO wallet_entries VALUES($1,$2,'vote')",[crypto.randomUUID(),wallet]),/authorization required/);
  await sql('ROLLBACK TO SAVEPOINT active_guard');
  const [stored]=await sql('SELECT * FROM wallet_cards');
  assert.match(stored.pin_hash,/^\$argon2id\$/);
  assert.equal(await secrets.verifyPin(stored.pin_hash,input.pin),true);
  const display=await issue('reveal');
  const {number}=await service.operate(user,session,'reveal',display);
  assert.match(number,/^\d{16}$/);
  assert.equal(number.slice(-1),secrets.checksum(number.slice(0,-1)));
  assert.equal(stored.number_lookup,secrets.lookup(number));
  assert.notEqual(stored.number_ciphertext,number);
  await assert.rejects(service.operate(user,session,'reveal',display),/CARD_CODE_INVALID/);
  const change=await issue('change_pin');
  for(let i=0;i<5;i++)await assert.rejects(service.operate(user,session,'change_pin',{...input,...change,current_pin:'000000'}),/CARD_PIN_WRONG/);
  await assert.rejects(service.operate(user,session,'change_pin',{...input,...change,current_pin:input.pin}),/CARD_RATE_LIMIT/);
  const recover=await issue('reset_pin');
  await service.operate(user,session,'reset_pin',{...recover,pin:'035870',confirm_pin:'035870'});
  await assert.rejects(service.operate(user,session,'reset_pin',{...recover,pin:'035870',confirm_pin:'035870'}),/CARD_CODE_INVALID/);
  const [updated]=await sql('SELECT version,pin_hash FROM wallet_cards');
  assert.equal(updated.version,2);
  assert.equal(await secrets.verifyPin(updated.pin_hash,'035870'),true);
  await service.operate(user,session,'block',{});
  const reactivation=await issue('reactivate');
  await service.operate(user,session,'reactivate',{...reactivation,current_pin:'035870'});
  await service.admin(admin,user,'block','Verified administrative suspension');
  assert.equal((await service.state(user)).card.status,'admin_blocked');
  assert.equal((await sql('SELECT version FROM wallet_cards'))[0].version,5);
  assert.equal((await sql("SELECT count(*)::int n FROM wallet_card_events WHERE action='admin_block' AND actor_id=$1",[admin]))[0].n,1);
  await assert.rejects(service.issue(user,session,'reissue','fr'),/CARD_RATE_LIMIT/);
  await sql('SAVEPOINT old_writer');
  await assert.rejects(sql("INSERT INTO wallet_entries VALUES($1,$2,'vote')",[crypto.randomUUID(),wallet]),/authorization required/);
  await sql('ROLLBACK TO SAVEPOINT old_writer');
  await sql("INSERT INTO wallet_entries VALUES($1,$2,'topup')",[crypto.randomUUID(),wallet]);
  await service.admin(admin,user,'release','Verified review completed');
  assert.equal((await service.state(user)).card.status,'holder_blocked');
  await sql("UPDATE wallet_card_limits SET until_at=now() WHERE user_id=$1 AND scope='send'",[user]);
  const replace=await issue('reissue');
  await service.operate(user,session,'reissue',{...replace,current_pin:'035870'});
  const [replacement]=await sql('SELECT wallet_id,number_lookup FROM wallet_cards');
  assert.equal(replacement.wallet_id,wallet);
  assert.notEqual(replacement.number_lookup,stored.number_lookup);
  console.log('OK — migration isolée, solde, unicité, Argon2id, OTP, limites, révocation et refus du débit historique.');
 }finally{await sql('ROLLBACK');}
}
async function main(){
 if(!process.argv.includes('--rollback-only'))throw new Error('Argument --rollback-only requis');
 require('dotenv').config({quiet:true});
 const client=new Client({host:process.env.DB_HOST,port:process.env.DB_PORT,database:process.env.DB_NAME,
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,connectionTimeoutMillis:8000,
  ssl:process.env.DB_SSL==='true'?{rejectUnauthorized:false}:undefined});
 try{await client.connect();await check(client);}finally{await client.end();}
}
main().catch(error=>{console.error(error.code||'CHECK_FAILED',error.message);process.exitCode=1;});
