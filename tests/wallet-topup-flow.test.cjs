const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {POLICY}=require('../src/services/walletTopupPricing');
const pricing={fee_policy:POLICY,votenow_fee_version_id:'2',votenow_payment_fee_bps:500,
 votenow_payment_fee_fcfa:50,net:1000,gross:1050,fee:50};

function load(file,deps,env={}) {
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/'+file),'utf8'),{
  module,exports:module.exports,process:{env},console,Date,Map,Set,URL,Buffer,
  require:name=>Object.hasOwn(deps,name)?deps[name]:require(require.resolve(name,{paths:[__dirname+'/../src/services']}))
 });
 return module.exports;
}
test('same availability parser accepts array-shaped operational deposits',async()=>{
 const {depositHealth}=load('paymentProviders/mobileHealth',{
  '../kpayClient':{availability:async()=>({data:[{country:'CMR',providers:[
   {provider:'ORANGE_CMR',operationTypes:[{operationType:'DEPOSIT',status:'OPERATIONAL'}]}
  ]}]})},'../../config/kpay':{getConfig:()=>({mode:'production'})}
 });
 assert.equal(await depositHealth('orange_money'),'available');
});
test('versioned 5 percent is included in selection and requires accounting',async()=>{
 let selected;
 let ready=false;
 const wallet=load('wallet', {
  '../config/database':{},'../models/Wallet':{},'../models':{},'./kpayOperations':{},
  './kpayClient':{},'../config/kpay':{getConfig:()=>({mode:'production'})},
  './votenowFees':{cardTopupTariff:async()=>{if(!ready)throw new Error('accounting missing');return {id:'2',rate_bps:500}}},
  './paymentProviders/manager':{select:async params=>{selected=params.amount;return {network:'ORANGE_CMR',rail:'orange_money'}}},
 },{WALLET_TOPUP_FEES_ENABLED:'true'});
 await assert.rejects(wallet.quote(1000,'699111222'),/accounting missing/);
 assert.equal(selected,undefined);
 ready=true;
 const result=await wallet.quote(1000,'699111222');
 assert.equal(selected,1050);
 for(const [key,value] of Object.entries(pricing))assert.equal(result[key],value);
});
function simulate(snapshot) {
 const gross=snapshot.gross;
 const operation={id:'operation',kind:'WALLET_TOPUP',domain_id:'topup',external_id:'external',environment:'production',
  status:'PENDING',expected_amount:gross,target_net:1000,provider_id:'provider',provider_fee:20,provider_net:gross-20,
  pricing_snapshot:snapshot,request_payload:{},async update(values){Object.assign(this,values)}};
 const topup={status:'pending',wallet_id:'wallet',amount_fcfa:1000,gross_fcfa:gross,pricing_snapshot:snapshot,
  async update(values){Object.assign(this,values)}};
 const entries=[];
 const {applyEvent}=load('kpayOperations',{
  './sponsoredPayout':{},'../models':{KpayOperation:{findOne:async()=>operation}},
  '../config/database':{transaction:fn=>fn({LOCK:{UPDATE:1}})},'./kpayClient':{},
  '../config/kpay':{getConfig:()=>({mode:'production'})},'./withdrawalJournal':{},
  './votenowFees':{requireTopupAccounting:async()=>{}},
  '../models/Wallet':{WalletTopup:{findByPk:async()=>topup},WalletEntry:{create:async row=>entries.push(row)}},
 });
 const result=(status='COMPLETED',settlement={netAmount:gross-30},internal=false)=>applyEvent({
  event:status==='COMPLETED'?'payment.completed':'payment.failed',status,amount:gross,
  externalId:'external',paymentId:'provider',currency:'XAF',...settlement,
 },internal);
 return {result,topup,operation,entries};
}
test('authenticated success ignores stale initiation fee, credits principal once',async()=>{
 const flow=simulate(pricing);
 await assert.rejects(flow.result('COMPLETED',{},true),/invalide/);
 await flow.result();
 await flow.result();
 assert.equal(flow.topup.status,'success');
 assert.deepEqual(flow.entries.map(row=>row.amount_delta),[1000]);
});
test('failure credits nothing, historical no-fee success remains valid',async()=>{
 const failed=simulate(pricing);
 await failed.result('FAILED',{});
 assert.equal(failed.topup.status,'failed');
 assert.equal(failed.entries.length,0);
 const historical=simulate({fee_policy:'same_as_vote',gross:1000});
 await historical.result();
 assert.equal(historical.entries[0].amount_delta,1000);
});
