const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {Client} = require('pg');
const migrate = require('./migrate-financial-book');

async function check(client) {
  const query = async (sql, bind) => (await client.query(sql,bind)).rows;
  const db = {query};
  const schema = 'vn_book_check_' + randomUUID().replaceAll('-','');
  await query('BEGIN');
  try {
    await query("SET LOCAL statement_timeout='12s'");
    await query(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}`);
    await query(`
      CREATE TABLE users(id uuid PRIMARY KEY,role text,balance_fcfa bigint);
      CREATE TABLE events(id uuid PRIMARY KEY,organizer_id uuid);
      CREATE TABLE withdrawals(id uuid PRIMARY KEY,organizer_id uuid,amount_fcfa integer,status text,
        created_at timestamptz,fee_policy text,net_fcfa integer,fee_fcfa integer,pricing_snapshot jsonb);
      CREATE TABLE payments(id uuid PRIMARY KEY,status text,event_id uuid,wallet_user_id uuid,
        method text,amount_fcfa integer,net_to_organizer integer,commission_amount integer);
      CREATE TABLE wallet_accounts(id uuid PRIMARY KEY,user_id uuid,balance_fcfa integer);
      CREATE TABLE wallet_entries(id uuid PRIMARY KEY,wallet_id uuid,source_id uuid,source_kind text,amount_delta integer);
      CREATE TABLE wallet_topups(id uuid PRIMARY KEY,wallet_id uuid,amount_fcfa integer,gross_fcfa integer,pricing_snapshot jsonb);
      CREATE TABLE kpay_operations(id uuid PRIMARY KEY,kind text,domain_id uuid,environment text,status text,
        expected_amount integer,target_net integer,pricing_snapshot jsonb,last_event jsonb,error_code text,
        completed_at timestamptz,updated_at timestamptz);
    `);
    await query(fs.readFileSync(path.join(__dirname,'payment-providers.sql'),'utf8'));
    const [owner,voter,admin1,admin2,event,wallet,withdrawal,account,vote,deposit,topup,topupOp,cardVote,payout,evidence] =
      Array.from({length:15},randomUUID);
    await query("INSERT INTO users VALUES($1,'organizer',4000),($2,'voter',0),($3,'admin',0),($4,'admin',0)",[owner,voter,admin1,admin2]);
    await query('INSERT INTO events VALUES($1,$2)',[event,owner]);
    await query('INSERT INTO wallet_accounts VALUES($1,$2,1200)',[wallet,voter]);
    await query("INSERT INTO withdrawals VALUES($1,$2,1000,'processing',now()-interval '1 day','recipient_pays_v2',970,30,'{}')",[withdrawal,owner]);
    await query("INSERT INTO payment_providers(id,code) VALUES($1,'kpay')",[randomUUID()]);
    await query("INSERT INTO provider_accounts(id,provider_code,environment,account_key) VALUES($1,'kpay','production','confirmed-account')",[account]);
    await migrate(db,'500');
    await migrate(db,'500');
    const balance = async (name,kind) => Number((await query(`
      SELECT coalesce(sum(line.amount),0) AS total FROM financial_book b
      CROSS JOIN LATERAL jsonb_to_recordset(b.lines) AS line(account text,amount numeric)
      WHERE line.account=$1 AND ($2::text IS NULL OR b.kind=$2)`,[name,kind||null]))[0].total);
    assert.equal(await balance('historical_unprovisioned'),5000);
    assert.equal(await balance('card:'+wallet),-1200);
    const provider_selection = {provider_code:'kpay',account_id:account};
    const operation = async (id,kind,domain,amount,net,snapshot) =>
      query("INSERT INTO kpay_operations VALUES($1,$2,$3,'production','PENDING',$4,$5,$6,NULL,NULL,NULL,now())",
        [id,kind,domain,amount,net,{provider_selection,...snapshot}]);
    const finish = async (id,fee,net) => query(`
      UPDATE kpay_operations SET status='COMPLETED',last_event=$2,completed_at=now() WHERE id=$1`,
      [id,{status:'COMPLETED',feeAmount:fee,netAmount:net}]);
    await operation(deposit,'DEPOSIT',vote,1050,null,{votenow_payment_fee_fcfa:50});
    await query("INSERT INTO payments VALUES($1,'pending',$2,NULL,'mtn_momo',1000,850,150)",[vote,event]);
    await query("UPDATE payments SET status='success' WHERE id=$1",[vote]);
    await finish(deposit,20,1030);
    await finish(deposit,20,1030);
    // Legacy top-up accepted before coverage and completed afterwards.
    await operation(topupOp,'WALLET_TOPUP',topup,1030,1000,{});
    await query("INSERT INTO wallet_topups VALUES($1,$2,1000,1030,'{}')",[topup,wallet]);
    await query("INSERT INTO wallet_entries VALUES($1,$2,$3,'topup',1000)",[randomUUID(),wallet,topup]);
    await finish(topupOp,30,null);
    await query('INSERT INTO financial_settlement_evidence(operation_id,evidence_ref,actual_fee,actual_net,actor_id,verified_by,reason) VALUES($1,$2,30,1000,$3,$4,$5)',
      [topupOp,'confirmed-settlement-001',admin1,admin2,'Provider settlement matched by both reviewers']);
    await query("INSERT INTO payments VALUES($1,'success',$2,$3,'votenow_card',1000,850,150)",[cardVote,event,voter]);
    await query("INSERT INTO wallet_entries VALUES($1,$2,$3,'vote',-1000)",[randomUUID(),wallet,cardVote]);
    assert.equal(await balance('card:'+wallet),-1200);
    assert.equal(await balance('payment_fee'),-50);
    assert.equal(await balance('commercial_commission'),-300);
    assert.equal(await balance('collection_cost'),50);
    await operation(payout,'PAYOUT',withdrawal,1000,970,{});
    await query("UPDATE withdrawals SET status='done' WHERE id=$1",[withdrawal]);
    const entry = randomUUID();
    await query("INSERT INTO financial_journal_entries VALUES($1,$2,'settle','provider_success',$3,$4,now())",
      [entry,withdrawal,payout,withdrawal+':settle']);
    for (const [side,kind] of [['debit','pre_coverage'],['credit','provider_clearing']]) {
      const id = randomUUID();
      await query("INSERT INTO financial_accounts VALUES($1,$2,$3,'XAF','organizer_current')",[id,owner,kind]);
      await query("INSERT INTO financial_journal_lines VALUES($1,$2,$3,1000)",[entry,side,id]);
    }
    await query('SET CONSTRAINTS ALL IMMEDIATE');
    await finish(payout,30,970);
    assert.equal(await balance('organizer_reserved:'+withdrawal),0);
    assert.equal(await balance('payout_cost'),30);
    await query('INSERT INTO financial_funding_evidence VALUES($1,$2,$3,100,$4,$5,$6,now())',
      [evidence,account,'confirmed-ref-001',admin1,admin2,'External statement matched by both reviewers']);
    const rejects = async (sql,bind,pattern) => {
      await query('SAVEPOINT expected_error');
      await assert.rejects(query(sql,bind),pattern);
      await query('ROLLBACK TO SAVEPOINT expected_error; RELEASE SAVEPOINT expected_error');
    };
    await rejects('UPDATE payout_fee_funding SET funded_fcfa=999',[],/audited evidence/);
    await rejects("UPDATE financial_book SET nominal_fcfa=0",[],/immuable/);
    await rejects(`INSERT INTO financial_book(kind,source_id,lines)
      VALUES ('invalid',$1,'[{"account":"cash","amount":10},{"account":"fees","amount":-9}]')`,[randomUUID()],/check constraint/);
    await rejects(`SELECT vn_book_post('mobile_vote',$1,NULL,NULL,NULL,0,'{"cash":1,"fees":-1}')`,[vote],/replay differs/);
    await query('SELECT vn_book_post($1,$2,NULL,NULL,NULL,0,$3)', ['idempotency_check',event,{cash:1,fees:-1}]);
    await query('SELECT vn_book_post($1,$2,NULL,NULL,NULL,0,$3)', ['idempotency_check',event,{fees:-1,cash:1}]);
    assert.equal((await query("SELECT count(*)::int AS n FROM financial_book WHERE kind='idempotency_check'"))[0].n,1);

    const dbPath = require.resolve('../src/config/database');
    require.cache[dbPath] = {id:dbPath,loaded:true,exports:{
      QueryTypes:{SELECT:'SELECT'}, transaction:(_,fn)=>fn(null),query:(sql,options)=>query(sql,options.bind),
    }};
    const router = require('../src/routes/financialBookRoutes');
    const invoke = (route, req) => new Promise(resolve => {
      const response = {set(){return this},status(code){this.code=code;return this},json(value){resolve([this.code||200,value])}};
      router.stack.find(layer => layer.route.path===route).route.stack[0].handle(req,response);
    });
    const [status,report] = await invoke('/',{query:{provider:'kpay'}});
    assert.equal(status,200,JSON.stringify(report));
    assert.equal(Number(report.totals.nominal),1000);
    assert.equal(Number(report.totals.payout_cost),30);
    assert.equal(Number(report.funding[0].remaining),100);
    assert.equal(Number(report.positions.historical_unprovisioned),5000);
    const [filtered,subset] = await invoke('/',{query:{kind:'collection_settlement',from:'2000-01-01',to:'2099-01-01'}});
    assert.equal(filtered,200);
    assert.equal(subset.entries.length,2);
    assert.equal(subset.entries.find(row=>row.operation_id===topupOp).evidence_ref,'confirmed-settlement-001');
    const [published] = await invoke('/tariffs',{user:{id:admin1},body:{flow:'mobile_vote',rate_bps:600,
      effective_at:new Date(Date.now()+86400000).toISOString(),reason:'Future simulation version'}});
    assert.equal(published,200);
    const dbQuote = require('../src/services/votenowFees');
    require.cache[dbPath].exports.query = async (sql) => [await query(sql)];
    assert.equal((await dbQuote.mobileVoteTariff()).rate_bps,500);
    const legacyVote = randomUUID();
    await operation(randomUUID(),'DEPOSIT',legacyVote,1030,null,{});
    await query("INSERT INTO payments VALUES($1,'success',$2,NULL,'mtn_momo',1000,850,150)",[legacyVote,event]);
    assert.equal(await balance('payment_fee'),-50);
    assert.equal(await balance('reconciliation_difference','mobile_vote'),-30);
    const pricedTopup=randomUUID(),pricedOperation=randomUUID();
    const pricing={fee_policy:'votenow_topup_fee_v1',votenow_payment_fee_fcfa:50,
      votenow_payment_fee_bps:500,votenow_fee_version_id:'2',gross:1050,net:1000,fee:50};
    await operation(pricedOperation,'WALLET_TOPUP',pricedTopup,1050,1000,pricing);
    await query('INSERT INTO wallet_topups VALUES($1,$2,1000,1050,$3)',[pricedTopup,wallet,pricing]);
    await query("INSERT INTO wallet_entries VALUES($1,$2,$3,'topup',1000)",[randomUUID(),wallet,pricedTopup]);
    await finish(pricedOperation,20,1030);
    await finish(pricedOperation,20,1030);
    assert.equal(await balance('card:'+wallet,'card_topup'),-2000);
    assert.equal(await balance('payment_fee','card_topup'),-50);
    assert.equal((await query("SELECT count(*)::int AS n FROM financial_book WHERE kind='collection_settlement' AND source_id=$1",[pricedOperation]))[0].n,1);
    console.log('OK — migrations isolées, ouvertures, 4 flux, coûts, enveloppe, rejeu, agrégats et tarifs.');
  } finally {
    await query('ROLLBACK');
  }
}

async function main() {
  if (!process.argv.includes('--rollback-only')) throw new Error('Argument --rollback-only requis');
  require('dotenv').config({quiet:true});
  const client = new Client({host:process.env.DB_HOST,port:process.env.DB_PORT,database:process.env.DB_NAME,
    user:process.env.DB_USER,password:process.env.DB_PASSWORD,connectionTimeoutMillis:8000,
    ssl:process.env.DB_SSL==='true'?{rejectUnauthorized:false}:undefined});
  try { await client.connect(); await check(client); }
  finally { await client.end(); }
}
if (require.main === module) main().catch(error=>{
  console.error(error.code||'CHECK_FAILED',error.message);
  process.exitCode=1;
});
