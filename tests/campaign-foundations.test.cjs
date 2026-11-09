const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { classifyFailure, publicFailure } = require('../src/services/paymentFailure');
const Op = Object.fromEntries(['or','and','in','gt','lte'].map(k => [k, Symbol(k)]));
function load(file, dependencies) {
  dependencies['./walletCredit']=require('../src/services/walletCredit');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/', file), 'utf8'), {module, exports: module.exports, require: name => {
    if (name in dependencies) return dependencies[name];
    if (name.startsWith('node:')) return require(name);
    throw new Error(`Unexpected dependency ${name}`);
  }, console, Date, Map, Set, Buffer});
  return module.exports;
}
const query = load('services/publicCampaigns.js', {'sequelize': {Op}});
function match(row, condition) {
  return Reflect.ownKeys(condition).every(key => {
    const value = condition[key];
    if (key === Op.or) return value.some(c => match(row, c));
    if (key === Op.and) return value.every(c => match(row, c));
    if (value && typeof value === 'object' && !(value instanceof Date)) return Reflect.ownKeys(value).every(op => {
      if (op === Op.in) return value[op].includes(row[key]);
      if (row[key] == null) return false;
      if (op === Op.gt) return new Date(row[key]) > new Date(value[op]);
      if (op === Op.lte) return new Date(row[key]) <= new Date(value[op]);
      return false;
    });
    return row[key] === value;
  });
}
test('insufficient balance has a useful message without exposing raw operator data', () => {
  for (const reason of ['INSUFFICIENT_FUNDS', 'INSUFFICIENT_BALANCE', 'Solde du compte insuffisant']) assert.equal(classifyFailure(reason), 'INSUFFICIENT_FUNDS');
  assert.match(publicFailure({last_event: {failureReason: 'INSUFFICIENT_FUNDS phone=237600000000'}}, 'failed').failure_message, /Rechargez/);
  assert.equal(publicFailure(null, 'pending').failure_message, null);
  assert.equal(classifyFailure('unknown secret error'), 'PAYMENT_FAILED');
});
test('PIN, cancellation and expiry are distinguished, unknown reason stays generic', () => {
  assert.equal(classifyFailure('INVALID_PIN'), 'INVALID_PIN');
  assert.equal(classifyFailure('USER_CANCELLED'), 'USER_CANCELLED');
  assert.equal(classifyFailure('payment expired'), 'EXPIRED');
  assert.equal(classifyFailure(null), 'PAYMENT_FAILED');
});
const now = new Date('2026-11-08T12:00:00Z');
const campaigns = [
 {id:1,status:'active',starts_at:null,ends_at:null},
 {id:2,status:'active',starts_at:'2026-12-01',ends_at:null},
 {id:3,status:'active',starts_at:null,ends_at:'2026-11-01'},
 {id:4,status:'closed',starts_at:null,ends_at:null},
 {id:5,status:'draft',starts_at:null,ends_at:null},
 {id:6,status:'paused',starts_at:null,ends_at:null},
];
campaigns.forEach(c => { c.archived_at = null });
for (const [status, expected] of [['all',[1,2,3,4]],['active',[1]],['upcoming',[2]],['closed',[3,4]]]) test(`filter ${status} excludes drafts and handles dates`, () => {
 const {where} = query.buildPublicQuery({status}, now);
 assert.deepEqual(campaigns.filter(c => match(c,where)).map(c=>c.id), expected);
});
test('invalid filters rejected; pagination bounded', () => {
 assert.throws(() => query.buildPublicQuery({status:'draft'}));
 assert.equal(query.buildPublicQuery({page:-5,limit:999}).page,1);
 assert.equal(query.buildPublicQuery({page:-5,limit:999}).limit,100);
});
test('reconciliation retains failureReason and never credits a failed payment', async () => {
 let credited = false;
 const payment = {status:'pending', async update(values) { Object.assign(this, values); }};
 const operation = {id:'op',kind:'DEPOSIT',domain_id:'payment',provider_id:'provider',external_id:'ext',environment:'production',expected_amount:100,status:'PENDING',request_payload:{}, async update(values) {Object.assign(this,values);}};
 const models = {
   KpayOperation: {findByPk:async()=>operation,findOne:async()=>operation},
   Payment:{findByPk:async()=>payment},
   User:{increment:async()=>{credited=true;}},
 };
 const api = load('services/kpayOperations.js', {
   '../models':models,'../config/database':{transaction:async fn=>fn({LOCK:{UPDATE:'UPDATE'}})},
   './kpayClient':{getPayment:async()=>({id:'provider',externalId:'ext',amount:100,currency:'XAF',isTest:false,status:'FAILED',failureReason:'INSUFFICIENT_FUNDS'})},
   '../config/kpay':{getConfig:()=>({mode:'production'})},
   './kpayAmounts':{normalizePhone:v=>v},
 });
 await api.reconcileDeposit('op');
 assert.equal(payment.status,'failed');
 assert.equal(operation.last_event.failureReason,'INSUFFICIENT_FUNDS');
 assert.equal(credited,false);
});
test('campaign deletion hooks block individual and bulk removal', () => {
 let options;
 load('models/Event.js', {
  sequelize:{DataTypes: new Proxy({}, {get:()=>new Proxy(function(){},{get:()=>()=>{},apply:()=>({})})})},
  '../config/database':{define:(name,fields,opts)=>{options=opts;return {};}}
 });
 assert.throws(()=>options.hooks.beforeDestroy(), /supprim/);
 assert.throws(()=>options.hooks.beforeBulkDestroy(), /supprim/);
});
