const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function load(env,prediction={country:'CMR',provider:'ORANGE_CMR'},models={}){let calls=0;const module={exports:{}};const deps={'../config/database':{},'../models/Wallet':models,'../models':{},'./kpayOperations':{failure:(m,status=400)=>Object.assign(new Error(m),{status}),hash:()=>''},'./kpayClient':{predictProvider:async()=>{calls++;return prediction},availability:async()=>[{country:'CMR',providers:[{provider:'ORANGE_CMR',operationTypes:{DEPOSIT:'OPERATIONAL'}}]}]},'../config/kpay':{getConfig:()=>({mode:'sandbox'})},'./walletTopupPricing':require('../src/services/walletTopupPricing'),'./paymentProviders/mobileHealth':{depositHealth:async()=> 'available'},'./kpayAmounts':require('../src/services/kpayAmounts')};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/services/wallet.js'),'utf8'),{module,exports:module.exports,require:name=>name in deps?deps[name]:require(name),process:{env},console,Buffer});return {...module.exports,calls:()=>calls}}
test('wallet uses the same cash-in amount as votes without extra fee configuration',async()=>{const w=load({});const q=await w.quote(1000,'699111222');assert.equal(q.gross,1000);assert.equal(q.net,1000);assert.equal(q.fee,0);assert.equal(q.fee_policy,'same_as_vote');assert.equal(q.phone,'237699111222');assert.equal(w.calls(),1)});
test('wallet rejects unsupported operators and small recharge amounts',async()=>{const w=load({KPAY_WALLET_PRICING_CONFIRMED:'true'},{country:'OTHER',provider:'OTHER'});await assert.rejects(w.quote(1000,'699111222'),e=>e.status===422);await assert.rejects(w.quote(99,'699111222'));assert.equal(w.calls(),1)});
test('unverified users cannot initiate a recharge or debit',async()=>{const w=load({});await assert.rejects(w.initiate({is_verified:false},{}),e=>e.status===403);await assert.rejects(w.spend({is_verified:false},{},'fixture'),e=>e.status===403)});

test('new external quotes require multiples of 500 within existing limits',async()=>{
 const w=load({});
 for(const amount of [100,499,500.5,750,1000500])await assert.rejects(w.quote(amount,'699111222'),e=>e.status===400);
 assert.equal(w.calls(),0);
 for(const amount of [500,1500,3500,1000000])assert.equal((await w.quote(amount,'699111222')).net,amount);
});
test('a recorded recharge below the new minimum can still be resumed',async()=>{
 const topup={wallet_id:'wallet',amount_fcfa:100,phone:'237699111222'};
 const w=load({},undefined,{WalletAccount:{findOne:async()=>({id:'wallet'})},WalletTopup:{findOne:async()=>topup}});
 const input={request_id:'00000000-0000-4000-8000-000000000001',amount:100,phone:'699111222'};
 assert.equal(await w.initiate({id:'user',is_verified:true},input),topup);
 assert.equal(w.calls(),0);
});
