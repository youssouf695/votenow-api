const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {createRequire}=require('node:module');

function load(file, stubs, env={}) {
  const filename=path.resolve(__dirname,'../src',file);
  const localRequire=createRequire(filename);
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'), {
    module,exports:module.exports,process:{env},console,Date,Buffer,
    require:name=>Object.hasOwn(stubs,name)?stubs[name]:localRequire(name),
  });
  return module.exports;
}

const POLICY='votenow_pays_v1';
const route={provider_code:'kpay',id:'cap',account_id:'account',account_key:'default',rail:'orange_money',direction:'payout',environment:'sandbox',min_amount:500,max_amount:2000};
const tariff={id:'tariff',source:'adapter',rate_units:0,fixed_fee:0,min_fee:0,max_fee:null,rounding:'exact'};
const config={getConfig:()=>({mode:'sandbox'})};

test('exact-net capability uses confirmed adapter terms, rejects unsupported or out-of-range gross',async()=>{
  const adapter=load('services/paymentProviders/kpay.js',{
    '../kpayClient':{pricelist:async()=>({countries:[{code:'CMR',currency:'XAF',operators:[{operator:'Orange',withdrawalRate:.02}]}]})},
    '../../config/kpay':config,
  },{KPAY_PAYOUT_PRICING_CONFIRMED:'true',KPAY_PAYOUT_EXACT_NET_RAILS:'orange_money',KPAY_PAYOUT_ROUNDING:'round_fee'});
  const db={query:async sql=>[sql.includes('provider_tariff_versions')?[tariff]:[route]]};
  const {createManager}=load('services/paymentProviders/manager.js',{'../../config/database':db,'./kpay':adapter});
  const input={environment:'sandbox',direction:'payout',amount:1000,rail:'orange_money',exactNet:true};
  const quote=await createManager().select(input);
  assert.equal(quote.gross,1020);
  assert.equal(quote.fee,20);
  assert.equal(quote.net,1000);
  await assert.rejects(()=>createManager({kpay:{...adapter,quoteExactNet:undefined}}).select(input),{code:'NO_PAYMENT_PROVIDER'});
  const unconfirmed=load('services/paymentProviders/kpay.js',{'../kpayClient':{},'../../config/kpay':config});
  assert.equal(unconfirmed.quoteExactNet(route,1000,tariff),null);
  await assert.rejects(()=>createManager().select({...input,amount:2000}),{code:'NO_PAYMENT_PROVIDER'});
});

function fixture(policy=POLICY,ready=true,funded=100) {
  let balance=5000, feeEntry=null;
  let id=0;
  const postings=[];
  const transaction={LOCK:{UPDATE:'UPDATE'}};
  const snapshot={policy:POLICY,amount:1000,gross:1020,fee:0,net:1000,provider_fee:20,net_contract:'gross_less_fee_v1',
    network:'ORANGE_CMR',environment:'sandbox',provider_selection:{provider_code:'kpay',account_id:'account',capability_id:'cap'},tariff_terms:tariff};
  const withdrawal={id:'withdrawal',organizer_id:'owner',fee_policy:policy,amount_fcfa:1000,
    fee_fcfa:policy===POLICY?0:20,net_fcfa:policy===POLICY?1000:980,pricing_snapshot:policy===POLICY?snapshot:{rate:.02},
    status:'pending',async update(changes){Object.assign(this,changes)}};
  const operation={id:'op',kind:'PAYOUT',domain_id:'withdrawal',expected_amount:policy===POLICY?1020:1000,
    target_net:withdrawal.net_fcfa,request_payload:{},pricing_snapshot:withdrawal.pricing_snapshot,
    status:'PENDING',environment:'sandbox',provider_net:1000,async update(changes){Object.assign(this,changes)}};
  const db={transaction:fn=>fn(transaction),async query(sql,{replacements:r}={}) {
    if(sql.includes('AS ready'))return [[{ready}]];
    if(sql.includes('FROM payout_fee_funding'))return [[{funded_fcfa:String(funded)}]];
    if(sql.includes('sum(fee_fcfa)'))return [[{used:'0'}]];
    if(sql.includes('INSERT INTO payout_fee_reservations')){feeEntry={fee:r.fee,state:'reserved'};return [];}
    if(sql.includes('UPDATE payout_fee_reservations')){
      if(feeEntry?.state!=='reserved')return [[]];
      feeEntry.state=r.state;return [[{withdrawal_id:r.id}]];
    }
    if(sql.includes('UPDATE users')){balance+=r.delta;return [[{balance_fcfa:balance}]];}
    if(sql.includes('SELECT id FROM financial_accounts'))return [[{id:r.kind}]];
    return [];
  }};
  const sponsored=load('services/sponsoredPayout.js',{'../config/database':db,'../config/kpay':config});
  const journal=load('services/withdrawalJournal.js',{
    '../config/database':db,'./sponsoredPayout':sponsored,
    '../models/FinancialJournal':{FinancialJournalEntry:{findOne:async()=>postings.find(row=>row.kind==='reserve'),create:async row=>postings.push(row)},
      FinancialJournalLine:{bulkCreate:async lines=>{assert.equal(lines[0].amount_fcfa,1000);assert.equal(lines[1].amount_fcfa,1000);id++;}}},
  });
  const ops=load('services/kpayOperations.js',{'../config/database':db,'./sponsoredPayout':sponsored,
    '../config/kpay':config,'./withdrawalJournal':journal,'../models':{KpayOperation:{findOne:async()=>operation},Withdrawal:{findByPk:async()=>withdrawal}}});
  const event=type=>({event:'payout.'+type.toLowerCase(),status:type,externalId:'ext',paymentId:'payment',amount:operation.expected_amount,currency:'XAF'});
  return {sponsored,withdrawal,operation,ops,event,postings,state:()=>({balance,feeEntry,id}),
    async reserve(){await journal.postWithdrawal(withdrawal,'reserve','request',transaction);withdrawal.status='processing';}};
}

test('settles 1,000 FCFA net once and posts the cost separately, requiring confirmed net',async()=>{
  const f=fixture();
  await f.reserve();
  await f.ops.applyEvent(f.event('COMPLETED'));
  assert.equal(f.operation.status,'AWAITING_DETAILS');
  const confirmed={...f.event('COMPLETED'),netAmount:1000,feeAmount:20};
  await f.ops.applyEvent(confirmed,false,true);
  await f.ops.applyEvent(confirmed);
  assert.equal(f.withdrawal.status,'done');
  assert.equal(f.state().balance,4000);
  assert.equal(f.state().feeEntry.fee,20);
  assert.equal(f.state().feeEntry.state,'settled');
  assert.equal(f.postings.filter(row=>row.kind==='settle').length,1);
});

test('confirmed failure releases exactly 1,000 FCFA, unresolved failure holds it',async()=>{
  const f=fixture();
  await f.reserve();
  await f.ops.applyEvent(f.event('FAILED'));
  assert.equal(f.state().balance,4000);
  await f.ops.applyEvent(f.event('FAILED'),false,true);
  await f.ops.applyEvent(f.event('FAILED'),false,true);
  assert.equal(f.state().balance,5000);
  assert.equal(f.state().feeEntry.state,'released');
  assert.equal(f.postings.filter(row=>row.kind==='release').length,1);
});

test('historic recipient-pays withdrawal retains its net and never uses sponsored funding',async()=>{
  const f=fixture('recipient_pays_v2');
  await f.reserve();
  await f.ops.applyEvent({...f.event('COMPLETED'),netAmount:980,feeAmount:20});
  assert.equal(f.withdrawal.status,'done');
  assert.equal(f.withdrawal.net_fcfa,980);
  assert.equal(f.state().feeEntry,null);
});

test('sponsored quotes fail closed without accounting tables',async()=>{
  await assert.rejects(()=>fixture(POLICY,false).sponsored.quote(1000,'orange_money'),{status:503});
});

test('insufficient funded fees fail closed',async()=>{
  const f=fixture(POLICY,true,19);
  await assert.rejects(()=>f.sponsored.checkFunding(f.withdrawal.pricing_snapshot),{status:503});
});
