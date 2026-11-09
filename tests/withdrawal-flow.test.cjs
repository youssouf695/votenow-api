const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function load(file,deps,env={}){deps['./walletCredit']=require('../src/services/walletCredit');const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/',file),'utf8'),{module,exports:module.exports,process:{env},Buffer,console:{...console,error(){}},Date,Map,Set,URL,require:name=>Object.hasOwn(deps,name)?deps[name]:require(name)});return module.exports;}
function response(){return {statusCode:200,status(n){this.statusCode=n;return this},set(){return this},json(body){this.body=body;return this}}}
const uuid='11111111-1111-4111-8111-111111111111',bid='22222222-2222-4222-8222-222222222222';
function fixture(options={}){
 let balance=options.balance??5000,stored=null,created=0,quotes=0;
 const selected={id:bid,user_id:'owner',phone:'237699111222',method:'orange_money',full_name:'Beneficiary Test',verified_at:options.unverified?null:new Date('2026-01-01'),deleted_at:null};
 const user={id:'owner',is_verified:true,get balance_fcfa(){return balance}};
 const deps={
  '../models':{User:{findByPk:async()=>user,decrement:async fields=>{balance-=fields.balance_fcfa}},WithdrawalBeneficiary:{findOne:async q=>q.where.user_id==='owner'&&q.where.id===bid?selected:null},Event:{},Withdrawal:{findOne:async q=>q.where.request_key?stored:null,create:async data=>{created++;stored={id:'withdrawal-fixture',...data};return stored}}},
  '../config/database':{transaction:async fn=>fn({LOCK:{UPDATE:'UPDATE'}})},
  'express-validator':{validationResult:()=>({isEmpty:()=>true})},'sequelize':{Op:{in:Symbol('in')}},
  '../services/kpayAmounts':{integer:Number,normalizePhone:v=>v},
  '../services/recipientPayout':{recipientQuote:async()=>{quotes++;return {gross:3000,fee:60,net:2940,rate:.02,rounding:'exact',environment:'sandbox',policy:'recipient_pays_v2'}}}
 };
 return {controller:load('controllers/withdrawalController.js',deps),req:{user:{id:'owner'},body:{amount:3000,beneficiary_id:bid,request_id:uuid,expected_fee:60,expected_net:2940}},state:()=>({balance,stored,created,quotes})};
}
test('new withdrawal reserves gross once and freezes verified destination and net',async()=>{
 const f=fixture(),res=response();await f.controller.requestWithdrawal(f.req,res);assert.equal(res.statusCode,201);
 const {stored,balance,created}=f.state();assert.equal(balance,2000);assert.equal(created,1);assert.equal(stored.net_fcfa,2940);assert.equal(stored.fee_fcfa,60);assert.equal(stored.amount_fcfa,3000);assert.equal(stored.destination_phone,'237699111222');assert.equal(stored.fee_policy,'recipient_pays_v2');
 const again=response();await f.controller.requestWithdrawal(f.req,again);assert.equal(again.statusCode,200);assert.equal(f.state().balance,2000);assert.equal(f.state().created,1);assert.equal(f.state().quotes,1);
});
test('arbitrary phone, unknown recipient, unverified recipient and insufficient balance cannot reserve money',async()=>{
 for(const mode of ['free-phone','foreign','unverified','balance']){
  const f=fixture({unverified:mode==='unverified',balance:mode==='balance'?2999:5000});
  if(mode==='free-phone')f.req.body.destination_phone='237677111222';if(mode==='foreign')f.req.body.beneficiary_id=uuid;
  const res=response();await f.controller.requestWithdrawal(f.req,res);assert.equal(res.statusCode,400,mode);assert.equal(f.state().created,0);assert.equal(f.state().balance,mode==='balance'?2999:5000);
 }
});
test('changed fee quote blocks reservation and amount changes cannot reuse a request key',async()=>{
 const f=fixture(),bad=response();f.req.body.expected_net=3000;await f.controller.requestWithdrawal(f.req,bad);assert.equal(bad.statusCode,409);assert.equal(f.state().created,0);
 f.req.body.expected_net=2940;await f.controller.requestWithdrawal(f.req,response());f.req.body.amount=4000;const replay=response();await f.controller.requestWithdrawal(f.req,replay);assert.equal(replay.statusCode,409);assert.equal(f.state().balance,2000);
});
function payoutFixture({deleted=false,changedFee=false}={}){
 const verified_at=new Date('2026-01-01');let sends=0;
 const withdrawal={id:'w',organizer_id:'owner',beneficiary_id:bid,beneficiary_verified_at:verified_at,fee_policy:'recipient_pays_v2',amount_fcfa:3000,fee_fcfa:60,net_fcfa:2940,status:'processing',destination_phone:'237699111222',destination_name:'Beneficiary Test',method:'orange_money',pricing_snapshot:{rate:.02,rounding:'exact',environment:'sandbox'}};
 const operation={id:'o',kind:'PAYOUT',status:'CREATED',domain_id:'w',external_id:'external',expected_amount:3000,target_net:3000,environment:'sandbox',request_payload:{amount:3000,phoneNumber:withdrawal.destination_phone,provider:'ORANGE_CMR'},async update(changes){Object.assign(this,changes)}};
 const beneficiary=deleted?null:{phone:withdrawal.destination_phone,full_name:withdrawal.destination_name,verified_at,method:withdrawal.method};
 const deps={'../models':{Withdrawal:{findByPk:async()=>withdrawal},WithdrawalBeneficiary:{findOne:async()=>beneficiary},KpayOperation:{findByPk:async()=>operation}},'../config/database':{transaction:async fn=>fn({LOCK:{UPDATE:'UPDATE'}})},'./kpayClient':{initiateWithdrawal:async data=>{sends++;assert.equal(data.amount,3000);return {id:'provider',externalId:'external',amount:3000,netAmount:2940,feeAmount:60}}},'../config/kpay':{getConfig:()=>({mode:'sandbox'})},'./kpayAmounts':{integer:Number,normalizePhone:x=>x,grossForNet:()=>{throw Error('Unexpected legacy quote')}},'./recipientPayout':{recipientQuote:async()=>({gross:3000,net:2940,fee:changedFee?61:60,rate:.02,rounding:'exact',environment:'sandbox'})}};
 return {ops:load('services/kpayOperations.js',deps,{KPAY_PAYOUT_PRICING_CONFIRMED:'true'}),withdrawal,operation,sends:()=>sends};
}
test('dispatcher sets recipient net from frozen reservation even with an older admin handler, and sends once',async()=>{
 const f=payoutFixture();await f.ops.dispatch('o');assert.equal(f.operation.target_net,2940);assert.equal(f.operation.status,'PENDING');assert.equal(f.sends(),1);await f.ops.dispatch('o');assert.equal(f.sends(),1);
});
test('deleted beneficiary, altered provider payload and changed tariff prevent outgoing transfer',async()=>{
 const f=payoutFixture({deleted:true});await assert.rejects(()=>f.ops.dispatch('o'),e=>e.status===409);assert.equal(f.sends(),0);
 const g=payoutFixture();g.operation.request_payload.phoneNumber='237677111222';await assert.rejects(()=>g.ops.dispatch('o'),e=>e.status===409);assert.equal(g.sends(),0);
 const h=payoutFixture({changedFee:true});await assert.rejects(()=>h.ops.payoutQuote(h.withdrawal),e=>e.status===409);assert.equal(h.sends(),0);
});
